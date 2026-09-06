# 章节执行合同结构化输出被截断导致 incomplete_json 与修复失效

## Goal

修复创作（滚动生产/章节细化）中 `novel.volume.chapter_execution_contract@v4` 结构化生成偶发抛
`[STRUCTURED_OUTPUT:incomplete_json] ... JSON 解析失败且修复未成功` 并暂停管线的问题。修复后，
长内容章节（尤其收官卷/高信息量章节）的章节执行合同能一次生成完成；即使主输出被截断，修复路径也
有足够输出预算把 JSON 补全，不再出现"主生成截断 → 修复沿用同一个小预算再次截断 → 不可恢复"的僵局。

## Background（实测证据）

- 复现案例：novel `cmtol3vlq006d01ns88nkjzdd`（148 章 / 4 卷，滚动生产收官）。日志中第 4 卷第 142 章
  的 `novel.volume.chapter_execution_contract@v4` 生成失败，director 按问题策略 `pause_for_manual`。
- 运行端：provider=`custom_cpa_bohe`，model=`minimax-m3`（自定义 OpenAI 兼容端点 → 结构化策略被解析为
  `prompt_json`，无原生 json_object/json_schema 强制）。
- 日志证据（`docker logs ai-novel-api-1`）：
  - `invoke_done rawChars=5572` → 随即 repair；`repair_done rawChars=5575`。两次输出字符长度几乎相同，
    且 `applied truncated-JSON heuristic (braces 7/5, brackets 18/17, ...)` 补括号后仍
    `未检测到完整 JSON 值`——两段输出都在 JSON 未闭合处（处于字符串内部）被硬截断。
  - 同一函数对同卷多数章节成功（rawChars 4.1k–6.1k），说明 3200 输出 token 预算对多数章节够用、
    仅对部分长内容章节不足。
- 预算链：`generateChapterTaskSheetDetail`（`chapterExecutionContractGeneration.ts:144`）固定
  `maxTokens: 3_200`；`factory.ts:322-325` 对结构化模式再钳 `min(3200, profile.safeStructuredMaxTokens=8192)`
  → 实际输出上限 3200。
- 修复链缺陷：`structuredInvokeRepair.ts` 的 `repairWithLlm` 复用 `input.maxTokens`（=主生成同一 3200），
  而修复需要**重新输出整份 JSON**，因此截断型失败下修复必然再次截断 → 外层抛
  `JSON 解析失败且修复未成功`（`structuredInvokeParser.ts`），`classifyStructuredOutputFailure` 归为
  `incomplete_json`。
- 系统性盲区：`structuredInvoke.ts` 流式循环只拼接 `chunk.content`，从不读取
  `finish_reason/stop_reason`，因此"因 max_tokens 截断"不可见、无日志、无自适应重试。

## Requirements

- 章节执行合同（`novel.volume.chapter_execution_contract@v4`，含 taskSheet、readerExperience、3–8 个
  sceneCard）的结构化输出预算必须能容纳完整输出，不再对长内容章节在 JSON 未闭合处截断。
- LLM 修复（JSON repair）的输出预算必须 ≥ 主生成的预算，且不低于该 provider/profile 的结构化安全上限
  （`safeStructuredMaxTokens`），保证"主输出截断 → 修复能补全"这一路径成立。
- 修复不改变既有语义：schema、提示词、postValidate 门禁、输出结构均不动。
- 不影响已完成章节/其它 prompt 的既有结构化行为；只放宽"上限天花板"，不改变已成功输出的内容。

## Acceptance Criteria

- [ ] `chapterExecutionContractGeneration` 对 `volumeChapterExecutionContractPrompt` 的输出预算从 3200
      提升到安全值（6400），修复路径预算提升到 provider 结构化安全上限（≥8192）。
- [ ] 复现案例（同卷收官长章节）重新生成该章执行合同不再报 `incomplete_json`，日志显示
      `repairUsed=false repairAttempts=0`（或一次成功 repair），管线不暂停。
- [ ] 新增/更新的单元测试通过：
      - 截断型输出（字符串未闭合）经本地启发式补引号/括号后可直接解析（不触发 LLM repair）；
      - 主输出截断触发 repair 时，repair 收到的 maxTokens 提升到安全上限（stub `factory.getLLM`
        断言入参）；
      - 流式 `finish_reason === "length"` 被捕获并进入结构化 invoke 日志（`truncated=true`）。
- [ ] `pnpm --filter @write-now/server test` 通过（shared build + server build + node tests）。
- [ ] 在 feature 分支完成，合入 beta；重新构建 API 容器镜像并重启后，由用户从小说页恢复/重跑暂停的
      章节，确认收官卷继续产出执行合同不再暂停。

## Non-goals

- 不改 schema、不改提示词、不改质量门禁语义。
- 不引入"检测到截断就自动重跑主生成"的多段重试编排（本任务用"主预算提升 + 修复预算提升"覆盖）。
- 不迁移数据、不改持久化结构。
- 不断言 cpa_bohe/minimax-m3 端点侧是否还存在独立于本进程的上限；若重跑后仍截断，由
  `finish_reason=length` 日志暴露，另行处理。
