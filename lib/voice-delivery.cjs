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
// 整次 Fish 合成的温和工程预设，不是官方音轨拟合或逐句数值语速。
const DELIVERY_SPEEDS = Object.freeze({ natural: 1.00, lively: 1.04, soft: 0.97, hesitant: 0.98, reflective: 0.96 });
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

function buildSpeechProsody(plan) {
  const checked = validateSpeechPlan(plan);
  let totalLength = 0;
  let weightedSpeed = 0;
  for (const segment of checked.segments) {
    const length = correctAnonPronunciation(segment.text).length;
    totalLength += length;
    weightedSpeed += length * DELIVERY_SPEEDS[segment.delivery];
  }
  const speed = Math.min(1.04, Math.max(0.96, Math.round(weightedSpeed / totalLength * 100) / 100));
  return { speed, normalize_loudness: true };
}

/* ---------- Bangstarlight-VITS2 朗读方案 ----------
   这条链路不接受 Fish 的 [emotion, delivery] 控制标记，台词必须是纯日语文本；
   该 Space 实测还会在 … – 〜 和空格上直接报错，所以做等价替换后按白名单兜底。
   它单块约 45 秒（含排队），因此只取能放进一块的前缀，超出部分标记为截断。 */
const VITS2_MAX_CHARS = 120;
const VITS2_EMOTIONS = Object.freeze({
  neutral: "",
  happy: "明るく嬉しそうな声",
  excited: "元気にはずんだ声",
  sad: "悲しげな声",
  empathetic: "優しく寄り添う声",
  embarrassed: "照れた小さな声",
  curious: "興味津々な声",
  surprised: "驚いた声",
  worried: "不安げな声",
  confident: "自信のある声",
  angry: "怒った声",
});
// 与上传脚本同款白名单：假名、汉字、ASCII 字母数字与已验证安全的标点，其余一律删除。
const VITS2_UNSAFE = /[^0-9A-Za-zぁ-ゖァ-ヺー一-鿿々、。！？「」『』（）・,.\-!?]/g;

function sanitizeVits2(text) {
  return String(text)
    .replace(/[…‥]+/gu, "。")
    .replace(/[–—―‐−]/gu, "-")
    .replace(/[〜～]/gu, "ー")
    .replace(/[ \t\u00a0\u3000\u2000-\u200b]+/gu, "")
    .replace(/[\r\n]+/g, "")
    .replace(VITS2_UNSAFE, "");
}

function clipAtBoundary(text, maxChars) {
  const head = text.slice(0, maxChars);
  const cut = Math.max(head.lastIndexOf("。"), head.lastIndexOf("、"), head.lastIndexOf("！"), head.lastIndexOf("？"));
  return cut >= maxChars * 0.5 ? head.slice(0, cut + 1) : head;
}

function buildPlainSpeech(plan, maxChars = VITS2_MAX_CHARS) {
  const checked = validateSpeechPlan(plan);
  const picked = [];
  let length = 0;
  let truncated = false;
  for (const segment of checked.segments) {
    let text = sanitizeVits2(correctAnonPronunciation(segment.text));
    if (!text) continue;
    if (text.length > maxChars) { text = clipAtBoundary(text, maxChars); truncated = true; }
    if (picked.length && length + text.length > maxChars) { truncated = true; break; }
    picked.push({ ...segment, text });
    length += text.length;
    if (length >= maxChars) {
      if (checked.segments.length > picked.length) truncated = true;
      break;
    }
  }
  if (!picked.length) throw invalid();
  let totalLength = 0;
  let weightedSpeed = 0;
  for (const segment of picked) {
    totalLength += segment.text.length;
    weightedSpeed += segment.text.length * DELIVERY_SPEEDS[segment.delivery];
  }
  const speed = Math.min(1.04, Math.max(0.96, Math.round(weightedSpeed / totalLength * 100) / 100));
  const first = picked[0];
  return {
    language: "ja",
    text: picked.map((segment) => segment.text).join(""),
    emotion: VITS2_EMOTIONS[first.emotion] || "",
    // 轻微情绪压低感情比重，避免把普通陈述也演成有情绪。
    styleWeight: first.intensity === "subtle" ? 0.8 : 1,
    // 该接口 length_scale 越大越慢，取语速预设的倒数，限制在与 Fish 相同的 0.96–1.04 区间。
    lengthScale: Math.min(1.04, Math.max(0.96, Math.round((1 / speed) * 100) / 100)),
    truncated,
  };
}

module.exports = { validateSpeechPlan, buildSpeechText, buildSpeechProsody, buildPlainSpeech, sanitizeVits2, correctAnonPronunciation, VITS2_MAX_CHARS };
