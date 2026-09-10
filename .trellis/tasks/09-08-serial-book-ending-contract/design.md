# 连载目标跨度收束 — 设计

## Architecture And Boundaries

不把 `serial_book` 升级成 `compact_book`。新增一条与紧凑全书终章判定同层的**目标跨度收官**能力，供卷骨架、节奏板、拆章、执行合同和写作上下文共用。

```
estimatedChapterCount
  -> buildDirectorCompletionProfile()
  -> endingRequiredBy = target
  -> isTargetSpanFinaleBeat(absoluteChapterOrder)
        compact_book: 沿用 isCompactBookFinaleBeat
        serial_book:  绝对章序 >= endingRequiredBy 则为收官
  -> volume skeleton / beat sheet / chapter list / writer context
```

判定属于规划运行时，不是 prompt 关键词。Prompt 只消费布尔结果。

## Data Flow

1. `volumeGenerationOrchestrator` 已写入 `completionProfile`。
2. 拆章 `generateBeatChunkedChapterList` 今天只把 `isCompactBookFinaleBeat` 传给 `isBookFinale`。改为 `isBookFinaleBeat`：紧凑全书语义不变；连载用绝对章序。
3. 卷骨架 / 节奏板今天没有“是否最后一卷/最后一拍”的硬开关。收官卷（最后一卷且目标章落在此卷）必须改 `nextVolumeHook` / `end_hook` 指令。
4. 写作：`renderBookContractText` 对连载收官章补充目标跨度收束句；`buildNarrativeProgressHint` 在收官窗口与合同一致。

## Contracts

- `isBookFinaleBeat`（名称以实现为准）输入：`completionProfile`、目标卷下标、各卷章预算、本拍结束的卷内章序。输出：是否进入全书目标收官。
- 连载收官允许余味和更长线伏笔，禁止“必须写下一卷/下一拍才成立”的新主线。
- 不新增连载完本审校 prompt，不把收束缺口升级为 `replan_required`。

## Compatibility

- `buildDirectorCompletionProfile(61+)` 保持 `serial_book`。
- 已保存正文不动。旧书要看到收束，需重生成收官卷或最后一拍。
- 紧凑全书 +5 章只收束预算不变。

## Trade-offs

| 选项 | 结果 | 为何不选 / 为何选 |
| --- | --- | --- |
| 把 150 章改成 compact_book | 强行三段式完本，破坏长篇分卷 | 不选 |
| 只改写作 hint | 规划仍要求留钩子 | 不选 |
| 共用收官判定 + 合同注入 | 规划到正文一致，且不停车 | 选 |

## Rollback

判定函数可单独回退；prompt 分支随 `isBookFinale` 一起回退。
