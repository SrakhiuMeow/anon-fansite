"use strict";

// 调用真实朗读准备逻辑，不联网、不使用模型或语音额度。
const assert = require("node:assert/strict");
const { validateSpeechPlan, buildSpeechText, correctAnonPronunciation } = require("../lib/voice-delivery.cjs");
let checks = 0;
const segment = (text, emotion = "neutral", pauseAfter = "none") => ({ text, emotion, pauseAfter });
const plan = (...segments) => ({ language: "ja", segments });
function test(name, run) { run(); checks++; console.log(`通过：${name}`); }

test("繁简汉字和Latin正反姓名使用固定假名读法，保留其余台词", () => {
  for (const name of ["千早愛音", "千早爱音", "Chihaya Anon", "Anon Chihaya", "CHIHAYA ANON", "aNoN cHiHaYa"]) {
    assert.equal(correctAnonPronunciation(`「${name}」って呼んでね。`), "「ちはや あのん」って呼んでね。", name);
  }
  assert.equal(correctAnonPronunciation("千早愛音と千早爱音は同じ名前だよ。"), "ちはや あのんとちはや あのんは同じ名前だよ。");
  assert.equal(correctAnonPronunciation("私はChihaya Anonです。Anonちゃんと呼んでね。"), "私はちはや あのんです。あのんちゃんと呼んでね。");
  assert.equal(correctAnonPronunciation("あの、Anon Chihayaなんだけど。アノンはAnonだよ。"), "あの、ちはや あのんなんだけど。アノンはあのんだよ。");
  assert.equal(buildSpeechText(plan(segment("Chihaya Anon"))), "ちはや あのん", "完整姓名纠正为假名后可直接朗读");
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

test("只有已验证语气由服务端生成标签，中性不默认开心", () => {
  const text = "怒っていないよ。うれしいと言ったのは引用なんだ。";
  assert.equal(buildSpeechText(plan(segment(text))), text);
  for (const emotion of ["happy", "excited", "sad", "empathetic", "embarrassed", "curious", "surprised", "worried", "confident", "angry"]) {
    const result = buildSpeechText(plan(segment(text, emotion)));
    assert.ok(result.startsWith(`[${emotion}]`), emotion);
    assert.ok(result.endsWith(text), "编排不能按词面把否定、引用改成别的台词");
    assert.deepEqual(result.match(/\[[^\]]+\]/g), [`[${emotion}]`], "不能再插入另一种情绪");
  }
});

test("话意转折使用受控短长停顿，每个非中性语义段显式标记，末段无额外尾停顿", () => {
  const result = buildSpeechText(plan(
    segment("驚いたよ。", "surprised", "short"),
    segment("まだ少し驚いている。", "surprised", "long"),
    segment("でも落ち着いて聞いてね。", "neutral"),
  ));
  assert.deepEqual(result.match(/\[[^\]]+\]/g), ["[surprised]", "[break]", "[surprised]", "[long-break]", "[calm]"]);
  assert.match(result, /驚いたよ。.*まだ少し驚いている。.*でも落ち着いて聞いてね。$/);
  assert.ok(!/\[(?:break|long-break)\]\s*$/.test(result));
  assert.ok(!/[\r\n]{2,}/.test(result), "不能为了停顿把台词拆成大段空白");
});

test("完整句子的标点和语义保留，编排仅添加需要的段落标签与固定读音", () => {
  const original = plan(segment("私、千早愛音だよ。次も一緒に練習しよう！", "confident"));
  const snapshot = JSON.stringify(original);
  const validated = validateSpeechPlan(original);
  assert.ok(validated && validated.language === "ja");
  assert.match(buildSpeechText(original), /^\[confident\]\s*私、ちはや あのんだよ。次も一緒に練習しよう！$/);
  assert.equal(JSON.stringify(original), snapshot, "不能在准备声音时改写调用方原对象");
});

test("控制标签只来自白名单编排，原始台词中的标签、额外字段与非法暂停均拒绝", () => {
  const invalid = [
    plan(segment("[happy]こんにちは。")), plan(segment("こんにちは<break/>。")),
    plan(segment("[[smile]]こんにちは。")), plan(segment("こんにちは\u0000。")),
    plan(segment("こんにちは\u200b。")), plan(segment("こんにちは\n。")),
    plan(segment("こんにちは。", "laughing")), plan(segment("こんにちは。", "happy][angry")),
    plan(segment("こんにちは。", "neutral", "short")),
    plan(segment("あ。", "neutral", "long"), segment("い。", "neutral", "long"), segment("う。")),
    plan({ ...segment("こんにちは。"), prompt: "SECRET" }),
  ];
  for (const value of invalid) {
    assert.throws(() => validateSpeechPlan(value));
    assert.throws(() => buildSpeechText(value), "builder也必须验证，不能借导出绕过边界");
  }
});

test("长短回复均使用有限段落，正文总长度包含所有段而非仅第一段", () => {
  assert.ok(validateSpeechPlan(plan(segment("あ".repeat(2000)))));
  assert.ok(validateSpeechPlan(plan(segment("あ。"), segment("い。"), segment("う。"), segment("え。"))));
  for (const value of [plan(), plan(...Array(5).fill(segment("あ。"))), plan(segment("あ".repeat(1001)), segment("い".repeat(1000))), plan(segment(`${"あ".repeat(1996)}千早愛音`))]) {
    assert.throws(() => validateSpeechPlan(value));
  }
});

console.log(`语音读音与编排验证通过：${checks} 组；0 次网络或合成请求。`);
