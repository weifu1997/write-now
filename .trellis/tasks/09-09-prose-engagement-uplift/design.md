# Design

## 行为缺口

| 现状 | 应有 |
|------|------|
| Writer 不强制对白/人物戏 | 推进章必须有对白与互动场景 |
| 拆章功能门只拦被动调查链 | 额外拦连续审计/收网同引擎 |
| 验收对所有章默认偏继续 | 开书 3 章 + 卷高潮：对话稀疏/追读弱 → 优先 repairable |

## 落点

1. `chapterWriter.prompts.ts`：升版本；核心约束加对话/人物戏/反报告体；反模式替换补充。
2. `chapterList.prompts.ts`：功能分配要求加「玩法引擎轮换」；`getChapterFunctionQualityIssue` 增加连续审计引擎检测。
3. `ProseQualityDetector`：新增 `prose_dialogue_sparse`（确定性后处理）。
4. `ChapterAcceptanceAssessmentService` + acceptance prompt：传入 `readGateTier`（`opening`/`climax`/`normal`）；关键档把对话稀疏与 engagement/voice 缺口导向 `repairable`。
5. 组装 `readGateTier`：`chapterOrder<=3` → opening；当前 beatKey 为 `climax`/`pressure_lock` 或 `isBookFinale` → climax。

## 不做

- 不改库存章节正文。
- 不用关键词路由用户意图。
- 不把普通章对话稀疏升级为 pause/replan。
