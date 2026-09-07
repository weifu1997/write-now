# 父任务设计：三条独立修复的边界

## Why A Parent

一次用户反馈里有三条互不阻塞的主链。父任务锁定产品原则和交叉验收；实现只发生在子任务。

## Shared Principles

- 新手完本优先：目标章数必须像“写到这里能停”，曲线必须能当规划工具，跟进红点必须表示“现在要处理”。
- AI-first：收官与冲突强度由结构化合同/模型输出，不用章节号关键词表或标题正则。
- 自动导演完成优先：本批修复不得把局部质量或曲线形状升级为全书失败。
- 不破坏已保存正文；旧数据用重规划/重拆章/收起跟进项收敛。
- 变更动作在源页面（导演跟进/小说工作区），运行记录只读。

## Child Boundaries

| 子任务 | 拥有 | 不得改 |
| --- | --- | --- |
| serial-book-ending-contract | 收官判定、骨架/节奏/拆章/写作合同 | compact_book 阈值、完本审校拦截连载 |
| chapter-list-conflict-curve | 拆章 schema/强度落库/缺省 3/写作消费 | 正文情绪分析、第二曲线 |
| follow-up-history-dismiss | 跟进收起动作、overview 待处理计数、侧栏角标 | 任务中心按钮、进度风险徽标任务 |

## Integration Risks

- 拆章 schema 同时被收官 prompt 和冲突强度字段改到 `chapterList.prompts.ts`：合并时按字段加法，不要互相覆盖“每章字段”那一段。
- 两边都可能改 `volume/shared.ts` 的书级结构句：收官句与冲突曲线块分开函数。
- 跟进与前两条无代码重叠，可先合。

## Suggested Merge Order

1. follow-up-history-dismiss（用户立刻能清红点，范围最小）
2. chapter-list-conflict-curve（schema 变更，宜单独验证）
3. serial-book-ending-contract（prompt/合同面最广）

顺序不是硬依赖，只是降低冲突。
