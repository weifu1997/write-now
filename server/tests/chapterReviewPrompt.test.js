const test = require("node:test");
const assert = require("node:assert/strict");

const { chapterReviewPrompt } = require("../dist/prompting/prompts/novel/review.prompts.js");

const BASE_INPUT = {
  novelTitle: "测试小说",
  chapterTitle: "第 1 章 起点",
  content: "他推开门，屋里没人。",
  ragContext: "",
};

function renderSystemText(input) {
  const [systemMessage] = chapterReviewPrompt.render(input, { blocks: [] });
  return systemMessage.content;
}

test("chapterReviewPrompt v3 renders anti-ai rule catalog with citation instructions", () => {
  assert.equal(chapterReviewPrompt.version, "v3");

  const directiveText = [
    "- [forbid-ending-elevation] 禁止段尾升华 (forbidden/high): 段落结尾不得出现主题升华式总结。",
  ].join("\n");
  const systemText = renderSystemText({ ...BASE_INPUT, antiAiDirectiveText: directiveText });

  assert.ok(systemText.includes("【反AI规则目录】"));
  assert.ok(systemText.includes("[规则标识] 与规则名"));
  assert.ok(systemText.includes("不得只凭目录推断正文有问题"));
  assert.ok(systemText.includes("[forbid-ending-elevation] 禁止段尾升华"));
});

test("chapterReviewPrompt omits catalog block when directive text is absent or empty", () => {
  const withoutField = renderSystemText(BASE_INPUT);
  const withEmptyField = renderSystemText({ ...BASE_INPUT, antiAiDirectiveText: "" });

  assert.ok(!withoutField.includes("【反AI规则目录】"));
  assert.ok(!withEmptyField.includes("【反AI规则目录】"));
  assert.ok(!withoutField.includes("undefined"));
});
