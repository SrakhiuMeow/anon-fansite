"use strict";

// 调用真实朗读准备逻辑，不联网、不使用模型或语音额度。
// 验证结构、编排和安全边界；不能据此判断真实模型对语气的理解或合成音频的自然度。
const assert = require("node:assert/strict");
const { validateSpeechPlan, buildSpeechText, buildSpeechProsody, correctAnonPronunciation } = require("../lib/voice-delivery.cjs");
let checks = 0;
const segment = (text, emotion = "neutral", pauseAfter = "none", intensity = "normal", delivery = "natural") => ({ text, emotion, pauseAfter, intensity, delivery });
const plan = (...segments) => ({ language: "ja", segments });
function test(name, run) { run(); checks++; console.log(`通过：${name}`); }

test("繁简汉字和Latin正反姓名使用固定假名读法，保留其余台词", () => {
  for (const name of ["千早愛音", "千早爱音", "Chihaya Anon", "Anon Chihaya", "CHIHAYA ANON", "aNoN cHiHaYa"]) {
    assert.equal(correctAnonPronunciation(`「${name}」って呼んでね。`), "「ちはや あのん」って呼んでね。", name);
  }
  assert.equal(correctAnonPronunciation("千早愛音と千早爱音は同じ名前だよ。"), "ちはや あのんとちはや あのんは同じ名前だよ。");
  assert.equal(correctAnonPronunciation("私はChihaya Anonです。Anonちゃんと呼んでね。"), "私はちはや あのんです。あのんちゃんと呼んでね。");
  assert.equal(correctAnonPronunciation("あの、Anon Chihayaなんだけど。アノンはAnonだよ。"), "あの、ちはや あのんなんだけど。アノンはあのんだよ。");
  assert.equal(buildSpeechText(plan(segment("Chihaya Anon"))), "[natural conversational delivery] ちはや あのん", "完整姓名纠正为假名后可直接朗读");
});

test("短姓名只在完整称呼边界转换，不破坏普通词、其他名字或品牌", () => {
  for (const name of ["愛音", "爱音", "Anon", "ANON"]) {
    assert.equal(correctAnonPronunciation(`「${name}」だよ。`), "「あのん」だよ。", name);
  }
  for (const text of [
    "anonymous", "anonymity", "Canon", "QAnon", "AnonWorks", "myAnon", "Anon2", "2Anon", "_Anon", "Anon_",
    "éAnon", "Anoné", "e\u0301Anon", "Anon\u0301", "ЖAnon", "AnonЖ", "熱愛音楽", "熱爱音乐", "ANON TOKYO", "Anon Tokyo",
  ]) assert.equal(correctAnonPronunciation(text), text, text);
});

test("URL和email中的姓名不被改写，同一句真正的人名仍可纠正", () => {
  const resources = [
    "https://example.com/Anon", "http://Anon.example/Chihaya/Anon?q=Anon", "www.anon.example/Anon",
    "ftp://example.com/Anon", "//example.com/Anon", "e\u0301Anon@example.com",
    "Anon@example.com", "test+Anon@example.com", "https://example.com/?name=Anon%20Chihaya",
  ];
  for (const resource of resources) {
    assert.equal(correctAnonPronunciation(resource), resource, resource);
    assert.equal(correctAnonPronunciation(`${resource} と「Chihaya Anon」を区別してね。`), `${resource} と「ちはや あのん」を区別してね。`);
  }
});

test("已验证语气强度和表达方式只生成一条白名单复合cue，中性不默认开心", () => {
  const text = "怒っていないよ。うれしいと言ったのは引用なんだ。";
  const deliveries = {
    natural: "natural conversational delivery", lively: "light animated conversational delivery",
    soft: "soft tone", hesitant: "slightly hesitant delivery", reflective: "calm reflective delivery",
  };
  for (const emotion of ["neutral", "happy", "excited", "sad", "empathetic", "embarrassed", "curious", "surprised", "worried", "confident", "angry"]) {
    for (const intensity of ["subtle", "normal"]) for (const [delivery, description] of Object.entries(deliveries)) {
      const result = buildSpeechText(plan(segment(text, emotion, "none", intensity, delivery)));
      const cue = emotion === "neutral" ? `[${description}]` : `[${intensity === "subtle" ? "slightly " : ""}${emotion}, ${description}]`;
      assert.equal(result, `${cue} ${text}`, `${emotion}/${intensity}/${delivery}`);
      assert.deepEqual(result.match(/\[[^\]]+\]/g), [cue], "同一段不能拆成多条标签或加入原始字段名");
      assert.ok(result.endsWith(text), "给定metadata的编排不能按词面把否定、引用改成别的台词");
      if (emotion === "neutral") assert.ok(!/happy|excited|angry|slightly neutral/.test(result));
    }
  }
});

test("话意转折使用受控短长停顿，每个语义段仅一条复合cue，末段无额外尾停顿", () => {
  const result = buildSpeechText(plan(
    segment("驚いたよ。", "surprised", "short", "normal", "lively"),
    segment("まだ少し驚いている。", "surprised", "long", "subtle", "hesitant"),
    segment("でも落ち着いて聞いてね。", "neutral", "none", "subtle", "reflective"),
  ));
  assert.deepEqual(result.match(/\[[^\]]+\]/g), ["[surprised, light animated conversational delivery]", "[break]", "[slightly surprised, slightly hesitant delivery]", "[long-break]", "[calm reflective delivery]"]);
  assert.match(result, /驚いたよ。.*まだ少し驚いている。.*でも落ち着いて聞いてね。$/);
  assert.ok(!/\[(?:break|long-break)\]\s*$/.test(result));
  assert.ok(!/[\r\n]{2,}/.test(result), "不能为了停顿把台词拆成大段空白");
});

test("完整句子的标点和语义保留，编排仅添加需要的段落标签与固定读音", () => {
  const original = plan(segment("私、千早愛音だよ。次も一緒に練習しよう！", "confident"));
  const snapshot = JSON.stringify(original);
  const validated = validateSpeechPlan(original);
  assert.ok(validated && validated.language === "ja");
  assert.match(buildSpeechText(original), /^\[confident, natural conversational delivery\]\s*私、ちはや あのんだよ。次も一緒に練習しよう！$/);
  assert.equal(JSON.stringify(original), snapshot, "不能在准备声音时改写调用方原对象");
});

test("五类表达方式使用明确的整次合成语速预设，统一启用响度归一化", () => {
  for (const [delivery, speed] of [["natural", 1], ["lively", 1.04], ["soft", 0.97], ["hesitant", 0.98], ["reflective", 0.96]]) {
    const actual = buildSpeechProsody(plan(segment("こんにちは。", "neutral", "none", "normal", delivery)));
    assert.deepEqual(actual, { speed, normalize_loudness: true }, delivery);
    assert.ok(Number.isFinite(actual.speed) && actual.speed >= 0.96 && actual.speed <= 1.04);
  }
});

test("混合表达按正文长度加权并保留两位小数，标签、停顿与首尾空白不参与权重", () => {
  // 10 字轻快 + 30 字沉思：(10 × 1.04 + 30 × 0.96) / 40 = 0.98；段均值则错误地得到 1。
  const mixed = plan(segment("あ".repeat(10), "happy", "short", "subtle", "lively"), segment("い".repeat(30), "worried", "none", "normal", "reflective"));
  assert.deepEqual(buildSpeechProsody(mixed), { speed: 0.98, normalize_loudness: true });
  const alternateCues = plan(segment(`  ${"あ".repeat(10)}  `, "neutral", "long", "normal", "lively"), segment("い".repeat(30), "empathetic", "none", "subtle", "reflective"));
  assert.deepEqual(buildSpeechProsody(alternateCues), { speed: 0.98, normalize_loudness: true });
  // 1 字轻快 + 2 字沉思 = 0.98666…，须四舍五入至 0.99。
  assert.deepEqual(buildSpeechProsody(plan(segment("あ", "neutral", "none", "normal", "lively"), segment("いう", "neutral", "none", "normal", "reflective"))), { speed: 0.99, normalize_loudness: true });
});

test("姓名使用纠音后的假名长度加权，不按原始汉字或Latin姓名长度估算", () => {
  // 三种写法均变成 7 字符的「ちはや あのん」。加上 10 字沉思段得 0.99294… → 0.99。
  // 原始汉字长 4、Latin 长 12，如错误使用原文权重，会分别得到 0.98 与 1.00。
  for (const name of ["千早愛音", "千早爱音", "Chihaya Anon", "Anon Chihaya"]) {
    assert.deepEqual(buildSpeechProsody(plan(segment(name, "neutral", "none", "normal", "lively"), segment("あ".repeat(10), "neutral", "none", "normal", "reflective"))), { speed: 0.99, normalize_loudness: true }, name);
  }
});

test("语速计算接受冻结输入且不改写调用方文本、数组或metadata", () => {
  const original = Object.freeze({ language: "ja", segments: Object.freeze([
    Object.freeze(segment("  千早愛音  ", "happy", "short", "subtle", "lively")),
    Object.freeze(segment("あ".repeat(10), "neutral", "none", "normal", "reflective")),
  ]) });
  const snapshot = JSON.stringify(original);
  const actual = buildSpeechProsody(original);
  assert.deepEqual(actual, { speed: 0.99, normalize_loudness: true });
  assert.equal(JSON.stringify(original), snapshot);
  actual.speed = 7;
  assert.deepEqual(buildSpeechProsody(original), { speed: 0.99, normalize_loudness: true }, "返回结果不共享可变状态");
});

test("控制标签只来自白名单编排，原始台词中的标签、额外字段与非法暂停均拒绝", () => {
  const invalid = [
    null, false, [], {}, { language: "ja", segments: [] },
    { ...plan(segment("こんにちは。")), prosody: { speed: 1.04 } },
    plan({ ...segment("こんにちは。"), speed: 1.04 }),
    plan(segment("[happy]こんにちは。")), plan(segment("こんにちは<break/>。")),
    plan(segment("[[smile]]こんにちは。")), plan(segment("こんにちは\u0000。")),
    plan(segment("こんにちは\u200b。")), plan(segment("こんにちは\n。")),
    plan(segment("こんにちは。", "laughing")), plan(segment("こんにちは。", "happy][angry")),
    ...[null, false, 1, [], {}, "", "SUBTLE", "soft", "subtle, happy", "[happy]", "normal "].map((intensity) => plan(segment("こんにちは。", "neutral", "none", intensity))),
    ...[null, false, 1, [], {}, "", "NATURAL", "quiet", "constructor", "__proto__", "toString", "[soft tone]", "soft][angry", "soft "].map((delivery) => plan(segment("こんにちは。", "neutral", "none", "normal", delivery))),
    plan({ text: "こんにちは。", emotion: "neutral", pauseAfter: "none", delivery: "natural" }),
    plan({ text: "こんにちは。", emotion: "neutral", pauseAfter: "none", intensity: "normal" }),
    plan(segment("こんにちは。", "neutral", "short")),
    plan(segment("あ。", "neutral", "long"), segment("い。", "neutral", "long"), segment("う。")),
    plan({ ...segment("こんにちは。"), prompt: "SECRET" }),
  ];
  for (const value of invalid) {
    assert.throws(() => validateSpeechPlan(value));
    assert.throws(() => buildSpeechText(value), "builder也必须验证，不能借导出绕过边界");
    assert.throws(() => buildSpeechProsody(value), (error) => error.code === "VOICE_TRANSLATION_FAILED", "语速builder也必须拒绝非法metadata，不能绕过验证");
  }
});

test("长短回复均使用有限段落，正文总长度包含所有段而非仅第一段", () => {
  assert.ok(validateSpeechPlan(plan(segment("あ".repeat(2000)))));
  assert.ok(validateSpeechPlan(plan(segment("あ。"), segment("い。"), segment("う。"), segment("え。"))));
  for (const value of [plan(), plan(...Array(5).fill(segment("あ。"))), plan(segment("あ".repeat(1001)), segment("い".repeat(1000))), plan(segment(`${"あ".repeat(1996)}千早愛音`))]) {
    assert.throws(() => validateSpeechPlan(value));
    assert.throws(() => buildSpeechProsody(value));
  }
});

console.log(`语音读音与编排验证通过：${checks} 组；0 次网络或合成请求。mock未验证真实模型语气识别和音频自然度。`);
