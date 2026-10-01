"use strict";

// 所有 Fish 控制标记均由这里的白名单生成，模型只提供结构化语义。
const EMOTIONS = new Set(["neutral", "happy", "excited", "sad", "empathetic", "embarrassed", "curious", "surprised", "worried", "confident", "angry"]);
const PAUSES = new Set(["none", "short", "long"]);
const INTENSITIES = new Set(["subtle", "normal"]);
// Fish S2 自由文本语气描述的有限工程提示，不代表精确声学参数或声优复刻。
const DELIVERIES = Object.freeze({
  natural: "natural conversational delivery",
  lively: "light animated conversational delivery",
  soft: "soft tone",
  hesitant: "slightly hesitant delivery",
  reflective: "calm reflective delivery",
});
const MAX_TEXT_LENGTH = 2000;
const PROTECTED = /((?:(?:[a-z][a-z0-9+.-]*:)?\/\/|www\.)[^\s<>"'「」『』（）()。、！？]+|[\p{L}\p{M}\p{N}._%+-]+@[\p{L}\p{M}\p{N}.-]+\.[\p{L}\p{M}]{2,})/giu;

function invalid() { const error = new Error("voice-plan"); error.code = "VOICE_TRANSLATION_FAILED"; return error; }

function blocksLatinName(character = "") {
  // 日语助词、敬称可紧邻 Latin 姓名；其他文字、组合符、数字及下划线仍算词内。
  return /[\p{M}\p{N}_]/u.test(character) || (/\p{L}/u.test(character) && !/[\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]/u.test(character));
}

function hasNameBoundary(source, offset, length) {
  return !blocksLatinName([...source.slice(0, offset)].at(-1)) && !blocksLatinName([...source.slice(offset + length)][0]);
}

function correctAnonPronunciation(text) {
  if (typeof text !== "string") throw invalid();
  // URL/邮箱整个跳过。汉字短名不用子串替换，Latin 名字要求 Unicode 字词边界。
  return text.split(PROTECTED).map((part, index) => {
    if (index % 2) return part;
    return part
      .replace(/千早[ \u3000]*(?:愛音|爱音)(?![\p{Script=Han}\p{Script=Latin}\p{M}\p{N}_])/gu, "ちはや あのん")
      .replace(/(?:Chihaya[ \u3000]+Anon|Anon[ \u3000]+Chihaya)/giu, (name, offset, source) => hasNameBoundary(source, offset, name.length) ? "ちはや あのん" : name)
      .replace(/(?<![\p{Script=Han}\p{Script=Latin}\p{M}\p{N}_])(?:愛音|爱音)(?![\p{Script=Han}\p{Script=Latin}\p{M}\p{N}_])/gu, "あのん")
      .replace(/Anon/giu, (name, offset, source) => {
        if (!hasNameBoundary(source, offset, name.length)) return name;
        const following = source.slice(offset + name.length);
        const brand = /^[ \u3000]+Tokyo/i.exec(following);
        if (brand && !blocksLatinName([...following.slice(brand[0].length)][0])) return name;
        return "あのん";
      });
  }).join("");
}

function validateSpeechPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan) || Object.keys(plan).sort().join(",") !== "language,segments" || plan.language !== "ja" || !Array.isArray(plan.segments) || plan.segments.length < 1 || plan.segments.length > 4) throw invalid();
  let length = 0;
  let correctedLength = 0;
  let pauses = 0;
  let longPauses = 0;
  let japanese = "";
  const segments = plan.segments.map((segment, index) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment) || Object.keys(segment).sort().join(",") !== "delivery,emotion,intensity,pauseAfter,text" || typeof segment.text !== "string" || !EMOTIONS.has(segment.emotion) || !PAUSES.has(segment.pauseAfter) || !INTENSITIES.has(segment.intensity) || typeof segment.delivery !== "string" || !Object.hasOwn(DELIVERIES, segment.delivery)) throw invalid();
    // 段内不用控制字符分割。ASCII 方括号与尖括号始终不能进入台词正文。
    if (/[\[\]<>\p{Cc}\p{Cf}]/u.test(segment.text)) throw invalid();
    const text = segment.text.trim();
    if (!text) throw invalid();
    length += text.length;
    const corrected = correctAnonPronunciation(text);
    correctedLength += corrected.length;
    japanese += corrected;
    if (segment.pauseAfter !== "none") pauses += 1;
    if (segment.pauseAfter === "long") longPauses += 1;
    if (index === plan.segments.length - 1 && segment.pauseAfter !== "none") throw invalid();
    return { text, emotion: segment.emotion, pauseAfter: segment.pauseAfter, intensity: segment.intensity, delivery: segment.delivery };
  });
  if (length > MAX_TEXT_LENGTH || correctedLength > MAX_TEXT_LENGTH || pauses > 3 || longPauses > 1 || !/[\u3041-\u3096\u30a1-\u30fa]/.test(japanese)) throw invalid();
  return { language: "ja", segments };
}

function buildSpeechText(plan) {
  const checked = validateSpeechPlan(plan);
  return checked.segments.map((segment) => {
    const emotion = segment.emotion === "neutral" ? "" : `${segment.intensity === "subtle" ? "slightly " : ""}${segment.emotion}, `;
    const cue = `[${emotion}${DELIVERIES[segment.delivery]}] `;
    const pause = segment.pauseAfter === "short" ? " [break]" : segment.pauseAfter === "long" ? " [long-break]" : "";
    return cue + correctAnonPronunciation(segment.text) + pause;
  }).join(" ");
}

module.exports = { validateSpeechPlan, buildSpeechText, correctAnonPronunciation };
