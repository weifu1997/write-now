const test = require("node:test");
const assert = require("node:assert/strict");

const { DEFAULT_ANTI_AI_RULES } = require("../dist/services/styleEngine/defaults.js");
const { buildAntiAiRuleCatalogText } = require("../dist/services/styleEngine/antiAiPreviewRules.js");
const { formatOpeningAvoidanceSamples } = require("../dist/services/novel/runtime/context/chapterSourceText.js");

const NEW_RISK_RULE_KEYS = [
  "risk-faint-quantity-modifiers",
  "risk-reflexive-reaction-adverbs",
  "risk-frozen-air-atmosphere-cliche",
  "risk-uniform-expression-formula",
  "risk-eye-flash-emotion-projection",
];

function toAntiAiRule(rule) {
  return {
    id: rule.key,
    key: rule.key,
    name: rule.name,
    type: rule.type,
    severity: rule.severity,
    description: rule.description,
    detectPatterns: rule.detectPatterns,
    rewriteSuggestion: rule.rewriteSuggestion,
    promptInstruction: rule.promptInstruction,
    autoRewrite: rule.autoRewrite,
    enabled: rule.enabled,
    globalBaselineEnabled: rule.globalBaselineEnabled,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test("default anti-ai catalog ships high-frequency AI cadence risk rules", () => {
  for (const key of NEW_RISK_RULE_KEYS) {
    const rule = DEFAULT_ANTI_AI_RULES.find((item) => item.key === key);
    assert.ok(rule, `missing default risk rule ${key}`);
    assert.equal(rule.type, "risk", `${key} should stay a risk rule`);
    assert.equal(rule.severity, "medium", `${key} should keep medium severity`);
    assert.ok(rule.globalBaselineEnabled, `${key} should join the global baseline`);
    assert.ok(rule.promptInstruction.trim().length > 0, `${key} needs promptInstruction`);
    assert.ok(rule.rewriteSuggestion.trim().length > 0, `${key} needs rewriteSuggestion`);
    assert.ok(rule.detectPatterns.length > 0, `${key} needs literal detection patterns`);
  }

  const keys = DEFAULT_ANTI_AI_RULES.map((item) => item.key);
  assert.equal(new Set(keys).size, keys.length, "default rule keys must stay unique");
});

test("anti-ai rule catalog text renders the new risk rules", () => {
  const catalog = buildAntiAiRuleCatalogText(DEFAULT_ANTI_AI_RULES.map(toAntiAiRule));

  assert.match(catalog, /\[risk-faint-quantity-modifiers\] 滥用「一丝、一抹」式模糊修饰 \(risk\/medium\)/);
  assert.match(catalog, /\[risk-reflexive-reaction-adverbs\] 滥用「不禁、不由得」式反应 \(risk\/medium\)/);
  assert.match(catalog, /\[risk-frozen-air-atmosphere-cliche\] 滥用「空气仿佛凝固」式氛围套话 \(risk\/medium\)/);
  assert.match(catalog, /\[risk-uniform-expression-formula\] 滥用「嘴角勾起」式表情公式 \(risk\/medium\)/);
  assert.match(catalog, /\[risk-eye-flash-emotion-projection\] 滥用「眼底闪过」式情绪投射 \(risk\/medium\)/);
});

test("encourage rules keep diverse replacement directions instead of stock small actions", () => {
  for (const rule of DEFAULT_ANTI_AI_RULES) {
    if (rule.type === "encourage") {
      assert.ok(rule.rewriteSuggestion.trim().length > 0, `${rule.key} needs rewriteSuggestion`);
    }
  }

  const uselessAction = DEFAULT_ANTI_AI_RULES.find((rule) => rule.key === "encourage-useless-action");
  assert.ok(uselessAction);
  assert.match(uselessAction.name, /生活化细节/);
  assert.match(uselessAction.rewriteSuggestion, /对话/);
  assert.match(uselessAction.rewriteSuggestion, /环境/);
  assert.match(uselessAction.rewriteSuggestion, /避免反复使用挠头、点烟、指节抵桌面这类万能小动作/);
  assert.match(uselessAction.promptInstruction, /不要每次都落到同一种小动作上/);

  const psychology = DEFAULT_ANTI_AI_RULES.find((rule) => rule.key === "forbid-explicit-psychology");
  assert.ok(psychology);
  assert.match(psychology.rewriteSuggestion, /同一篇里换用不同方向/);

  const frozenAir = DEFAULT_ANTI_AI_RULES.find((rule) => rule.key === "risk-frozen-air-atmosphere-cliche");
  assert.ok(frozenAir);
  assert.doesNotMatch(frozenAir.rewriteSuggestion, /做出一个小动作/);
});

test("opening avoidance samples render explicit avoid guidance or shrink to empty", () => {
  const rendered = formatOpeningAvoidanceSamples([
    { order: 4, title: "反压前夜", opening: "夜色沉沉，外城的灯一盏一盏灭下去。" },
    { order: 3, title: "", opening: "凌晨四点，他蹲在旅馆门口。" },
  ]);

  assert.match(rendered, /近几章这样开头（上一章在最前）：/);
  assert.match(rendered, /- 第4章 反压前夜：夜色沉沉/);
  assert.match(rendered, /- 第3章：凌晨四点/);
  assert.match(rendered, /规避要求：本章开头不得复用以上样本的开场表达模式/);

  assert.equal(formatOpeningAvoidanceSamples([]), "");
  assert.equal(
    formatOpeningAvoidanceSamples([{ order: 4, title: "空开头", opening: "   " }]),
    "",
  );
});
