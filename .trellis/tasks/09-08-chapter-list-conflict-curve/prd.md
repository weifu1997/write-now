# 拆章阶段生成有起伏的冲突强度曲线

## Goal

节奏/拆章页的紧张度曲线要能看出开局、加压、高潮、回落，而不是一条贴底的平线。这些数字从拆章就开始生成，并传到细化、执行合同和写作上下文。

## User Value

用户在节奏/拆章页看到紧张度曲线，会用它判断小说有没有张弛。现在曲线太平，既不能当规划工具，也不能证明正文有没有跟着节奏走。

## Confirmed Facts

- 曲线序列来自 `selectedVolume.chapters[].conflictLevel`（0–100），见 `OutlineCurrentVolumeWorkspace.tsx` / `StructuredOutlineWorkspace.tsx`。
- 拆章输出 schema（`generatedChapterBeatBlockItemSchema`）只有 `title`/`summary`/`beatKey`；prompt 写明“不得新增字段”。
- 节奏板固定槽位本身就有张弛：开卷抓手 → 首次升级 → 中段转向 → 高潮前挤压 → 卷高潮 → 卷尾钩子。
- 缺值时执行合同复用路径使用 `existingChapter.conflictLevel ?? 3`（`chapterExecutionContractGeneration.ts:116`）。3 在 0–100 上接近 0。
- `analyzeTensionCurveShape()` 把相邻差值 ≤ 3 判为“节奏平坝”。
- 用户锚定必须保留；AI 生成不得覆盖 `conflictLevelSource = "user"`。
- 写作组装器会拷贝 `conflictLevel`，但章节分层写作 prompt 没有把它解释成节奏约束。

## Requirements

1. 拆章（按拍生成章节列表）必须同时输出每章 `conflictLevel`，整数 0–100。
2. 同一拍、同一卷内必须有可见起伏：不能整卷都落在默认 3 附近，也不能整拍差值 ≤ 3。起伏要对应节奏槽位（开局低于高潮，挤压/高潮高于过渡），不要用标题关键词硬套。
3. 用户锚定章：重拆章、细化、执行合同生成都必须保留原值和 `source=user`。
4. 禁止再用 `?? 3` 作为 0–100 量纲的缺省。缺值应重试生成，或显示为“待定”断点，而不是一条贴底平线。
5. 章节细化/执行合同可在 AI 托管点上微调强度，但必须看见拆章曲线，不得把整卷重新抹平。
6. 写作上下文必须把本章冲突强度和相邻章升降解释给写作器，避免“曲线有起伏、正文无张弛”。
7. 不回填已保存正文。旧书缺值时，可通过重新拆章或现有“交还 AI”重算曲线；已有用户锚定不动。

## Acceptance Criteria

- [ ] 拆章 JSON schema 包含 `conflictLevel`（0–100）；prompt 不再禁止该字段。
- [ ] 新拆章落库后，节奏/拆章页曲线不再是全章 3 或全章缺失。
- [ ] 同一拍至少能看出加压或回落；高潮拍整体高于开卷拍。
- [ ] `conflictLevelSource=user` 的章在重拆章和细化后值不变。
- [ ] `conflictLevel ?? 3` 这条 0–100 缺省被删除；无值章以 null/待定表示。
- [ ] 写作上下文能读到本章强度及相对上一章的升/降/平。
- [ ] 单测覆盖：schema 接收强度、用户锚定保留、缺省 3 不再出现。
- [ ] 曲线形状失败最多触发结构化重试或质量提示，不得把自动导演打成失败。

## Out of Scope

- 对已写正文做事后情绪分析来画曲线。
- 第一期上第二序列（如 `revealLevel`）同屏。
- 自动改写已保存章节正文以匹配曲线。
- 全书收束合同、导演跟进角标（兄弟任务）。

## Key Decisions

- 紧张度仍是规划字段 `conflictLevel`，不是新数据模型。
- AI 生成曲线，确定性后处理只做校验/重试/保留锚定，不用规则表按标题派发分数。
- 曲线必须进入写作上下文，否则只解决“看起来平”，不解决“正文有没有张弛”。
