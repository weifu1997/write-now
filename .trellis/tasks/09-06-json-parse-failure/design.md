# 技术设计：结构化输出预算不足/修复预算复用的截断僵局

## 根因模型

`chapter_execution_contract@v4` 在长内容（收官）章节会生成较大的 JSON：boundary 字段 +
`taskSheet`(≤600 字) + `readerExperience`(多字段) + 3–8 个 `sceneCard`(每卡多字段)。运行在
`prompt_json` 策略下（自定义 OpenAI 兼容端点 minimax-m3，无原生结构强制），输出预算被固定为
`maxTokens=3200`。当单章内容使合法 JSON 需超过该预算时，输出在字符串内部被 max_tokens 截断 →
JSON 永不闭合 → 本地启发式无法补全 → 触发 LLM repair。

`repairWithLlm`（`structuredInvokeRepair.ts`）复用 `input.maxTokens`，而它等于主生成的同一 3200。
修复提示要求"重建完整 JSON 对象"，输出体积与原输出同量级 → 在相同截断点再次被截断 → repair 失败 →
外层抛"JSON 解析失败且修复未成功"，director 暂停。

两个放大盲区：
1. 流式循环从不读 `finish_reason/stop_reason`，length 截断不可观测。
2. `tryFixTruncatedJson` 只补括号/方括号，不补**悬挂字符串的闭引号**，因此"截断点在字符串内部"
   这一最常见截断形态无法本地修复。

## 方案

三层修复，全部是"放宽上限/增强恢复"，不改输出内容语义：

### 1. 提升该生成任务的输出预算

`chapterExecutionContractGeneration.ts:144`：

```ts
maxTokens: 3_200,   // → CHAPTER_EXECUTION_CONTRACT_MAX_TOKENS
```

文件顶部新增常量并注释预算依据（观察到 5.5k raw 字符≈截断前合法上限附近，取 6400 双倍余量；
低于 custom/minimax profile 的 `safeStructuredMaxTokens=8192`，`factory.ts` 的
`min(maxTokens, safeStructuredMaxTokens)` 不会把它再钳低）。该值同时成为 repair 的预算下限来源之一。

### 2. repair 输出预算提升到结构化安全上限

目标：修复必须能输出"比主生成更长"的完整 JSON。在解析层计算修复预算，让修复不继承主生成的紧上限。

`structuredInvokeParser.ts` 新增纯函数并导出：

```ts
export function resolveRepairMaxTokens(input: {
  maxTokens?: number;
  profile: StructuredOutputProfile;
}): number | undefined {
  const safe = input.profile.safeStructuredMaxTokens;
  if (typeof safe !== "number") {
    return input.maxTokens;               // 无安全上限口径：维持原状
  }
  if (typeof input.maxTokens !== "number") {
    return safe;
  }
  return Math.max(input.maxTokens, safe); // 修复预算 ≥ max(主预算, 安全上限)
}
```

两处 `repairWithLlm` 调用点（解析失败路径 + Zod 校验失败路径）在 `...input` 之后显式覆盖
`maxTokens: repairMaxTokens`。`StructuredRepairInput` 无需新增字段。

语义：仅在当前 profile 定义了安全上限时才提升；`safeStructuredMaxTokens` 缺省的原生结构化 profile
（json_schema/json_object，几乎不触发 repair）维持现状。`factory.ts` 对 structured 模式的钳制仍
`min(修复预算, safeStructuredMaxTokens)`，因此上限不会越过端点安全值。

### 3. 流式截断观测（finish_reason 捕获 + 日志）

`structuredInvoke.ts` 的 `invokeStructuredAttempt` 流式循环记录最后一个 chunk 的
`response_metadata.finish_reason`（openai 兼容 `"length"`/`"stop"`；anthropic `stop_reason`
`"max_tokens"`）。取值归一为 `finishReason: "length" | "stop" | string | undefined`，加入：

- `logStructuredInvokeEvent` 的 `invoke_done` 日志项（新可选字段 `finishReason`）；
- 解析阶段若 `finishReason ∈ {"length","max_tokens"}` 与解析失败同时发生，`invoke_error` 日志标记
  `truncated=true`（不改错误分类，仍为 `incomplete_json`）。

行为开关：仅观测，不驱动额外重试编排（见 Non-goals）。目的：预算提升后若仍截断，日志直接暴露
"端点侧仍有 3200/其它上限"，作为下一步证据。

### 4. 本地截断启发式支持"悬挂字符串补引号"

`tryFixTruncatedJson`（`structuredInvokeParser.ts`）在补括号前，先检测结尾是否处于未闭合字符串中
（自文本起点做 in-string 扫描，末尾 `inString===true` 且该字符串未被换行之外的语法破坏），是则先补一个
闭引号，再补括号/方括号。失败仍走 repair（预算已提升），不引入新降级。

```ts
function tryFixTruncatedJson(raw: string): string {
  const text = raw.trim();
  if (!text) return text;
  let fixed = text.replace(/,\s*$/g, "");
  fixed = closeDanglingStringIfNeeded(fixed);   // 新增
  const openBraces  = count(/[{}]/) 与闭合数差 ...  // 既有括号补齐逻辑，作用在 fixed 上
  ...
}
```

### 代码触点

| 文件 | 改动 |
|---|---|
| `server/src/services/novel/volume/chapterDetail/chapterExecutionContractGeneration.ts` | 预算常量 + `maxTokens` |
| `server/src/llm/structuredInvokeParser.ts` | `resolveRepairMaxTokens`、两处 repair 覆盖、`tryFixTruncatedJson` 补引号、`tryParseStructuredJsonValue` 复用 |
| `server/src/llm/structuredInvoke.ts` | 捕获 `finish_reason`，传入解析/日志 |
| `server/src/llm/structuredInvokeRepair.ts` | （如需）readme/接口说明；不改逻辑 |
| `server/tests/structuredInvoke.test.js` | 新增单测 |

## 风险与兼容

- **端点侧仍有独立上限**：若 cpa_bohe 对 minimax-m3 强制 3200 且忽略 `max_tokens`，本修复无法越过。
  由第 3 层 finish_reason 日志暴露；届时再评估（换端点/换模型/降 schema 体积）。验收清单含"重跑后仍截断
  则看日志 finishReason"的显式退出条件。
- **repair 预算全局抬高**：所有走 `prompt_json` repair 的 prompt 其修复上限升到 profile 安全值。
  上限=实际可用的天花板，不是实际输出量；仅当修复确实需要更多输出时才多付费。行为面安全。
- **启发式误补引号**：`closeDanglingStringIfNeeded` 只在"结尾确实处于未闭合字符串且补引号后
  `extractJSONValue` 能取到值"时生效；否则与现状一样进入 repair。不改变已能解析的正常输出。

## 验证路径

1. `pnpm --filter @write-now/server test`（server build + node tests）。
2. 重新构建 API 镜像并启动（compose 在 `infra/`），确认容器日志出现 `[llm.debug]`/结构化 invoke 正常。
3. 用户在小说页恢复/重跑暂停章节的执行合同生成；日志应显示该章 `invoke_done` 后 `repairUsed=false`
   或一次成功 repair，无 `pause_for_manual`。
