# 目标章数到达时必须形成可见收束

## Goal

用户设定的目标章数（例如 150 章）到达时，规划、拆章和正文都要把这一章写成看得见的小结局：有高潮、有本阶段兑现、可以留余味，但不能再开一条必须续写的新主线。

≤60 章的紧凑全书完本合同保持原样。

## User Value

新手把“150 章”理解成这本书写到这里应该像结束了。现在系统把 150 章当成连载中段，最后一章还在留钩子，读起来不像结局，也不像这一季的收束。

## Confirmed Facts

- `shared/types/directorCompletion.ts`：`target <= 60` → `compact_book`；否则 `serial_book`，`endingRequiredBy = target`，`maxChapterCount = target`。
- `isCompactBookFinaleBeat()`（`volumeChapterListGeneration.ts:54-68`）只在 `completionProfile.mode === "compact_book"` 时为真。连载最后一拍 `isBookFinale=false`。
- 拆章 prompt（`chapterList.prompts.ts`）在非终章时要求末章留下一拍牵引；骨架 prompt 只在紧凑全书时把最后一卷写成终局卷；节奏板 `end_hook` 必须承接 `nextVolumeHook`。
- 写作进度提示在 ≥90% 时要求收束全部主线，与连载“保留下一阶段拉力”冲突。
- 紧凑全书才有结局结构 prompt 和完本审校。连载没有目标跨度收束合同。
- 自动导演质量门：局部质量债不得阻断全书链。不能给 150 章加一个会把任务打成 `replan_required` 的强制完本审校。

## Requirements

1. 保留 `compact_book` / `serial_book` 分流。禁止把 61+ 章改成紧凑全书三段式。
2. 连载书在全书绝对章序达到 `endingRequiredBy` 时，最后一卷、最后一拍、目标章进入**目标跨度收束**：
   - 必须有可见高潮和本阶段核心回报；
   - 可以留余味、人物去向、未完成的更长线伏笔；
   - 禁止再创建“必须写下一阶段才能成立”的新主线；
   - `nextVolumeHook` / `end_hook` 在收官卷改为余味，而不是下一卷入口。
3. 收束判断必须用全书绝对章序（已有紧凑全书规则），不能把卷内第 N 章误当成全书第 N 章。
4. 规划、拆章、章节执行合同、写作上下文必须共用同一条“是否收官”判定，不能只改拆章 prompt。
5. 写作进度提示与收官合同对齐：接近目标章时写收束，不再同时要求“必须留下一阶段新钩子”。
6. 已保存正文不自动重写。已有 150 章书通过重生成收官卷/最后一拍/目标章合同后再生效。
7. 收束缺口最多记为章节级质量债或收官提示，不得单凭“还不够像结局”暂停自动导演。

## Acceptance Criteria

- [ ] `buildDirectorCompletionProfile(150)` 仍是 `serial_book`，`endingRequiredBy=150`。
- [ ] 存在与 `isCompactBookFinaleBeat` 同层的目标跨度收官判定：紧凑全书保持原语义；连载在绝对章序达到目标时为真。
- [ ] 连载收官拍的拆章指令变为完成小结局、禁止必须续写的新主线；非收官拍仍可留下一拍牵引。
- [ ] 连载最后一卷骨架不再被要求写出“必须进入下一卷”的钩子；紧凑全书终局卷规则不变。
- [ ] 连载收官拍的节奏板 `end_hook` 改为余味/收束，而不是下一卷入口。
- [ ] 写作上下文对连载收官章注入目标跨度收束说明；`narrativeProgressHint` 不再和“必须留新主线”对打。
- [ ] 相关单测覆盖：61/150 章仍是连载；收官判定按绝对章序；非收官拍行为不变。
- [ ] 不把局部文风或普通质量债升级为全书重规划。

## Out of Scope

- 提高 `compact_book` 阈值。
- 给连载套用 `novel.compact_book.ending_audit@v1` 并据此暂停任务。
- 自动重写已保存的第 150 章正文。
- 紧张度曲线、导演跟进角标（兄弟任务）。

## Key Decisions

- 150 章的产品结果是**本目标跨度的可见小结局**，不是把长篇改写成 60 章那种完本审校。
- 判定放在规划/拆章/写作共用函数，不在 prompt 里写死“第 150 章”。
- 完本审校仍只服务紧凑全书；连载收官用合同注入，缺证据时记债不停车。
