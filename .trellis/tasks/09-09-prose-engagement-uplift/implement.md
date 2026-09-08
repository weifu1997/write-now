# Implement

## Phase 1 — Writer 对话/人物戏

1. 升级 `novel.chapter.writer` 约束与反模式。
2. 单测或 prompt 契约测试（若已有 registry 测试则挂版本断言）。

## Phase 2 — 拆章去同构

3. 扩展 `getChapterFunctionQualityIssue`：连续 ≥3 章审计/收网引擎则失败。
4. 更新 chapter_list system 提示的功能分配要求。
5. 现有 `volumeChapterList` / progress 测试中补一条。

## Phase 3 — 关键章验收加严

6. `detectProseQuality` 增加对话稀疏。
7. acceptance 输入增加 `readGateTier`；prompt + service 对 opening/climax 更严。
8. 单元测试：稀疏正文在 opening 档触发 voice/repair 路径。

## Phase 4 — 文档与提交

9. wiki + release notes。
10. `node --test` 相关文件；阶段提交。

## 验证

```bash
pnpm --filter @write-now/server exec tsc -p tsconfig.json
pnpm --filter @write-now/server exec node --test tests/proseQualityDetector.test.js tests/volumeChapterList*.test.js # 及新增
```
