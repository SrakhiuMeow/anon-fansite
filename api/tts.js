"use strict";

// 无依赖的语音代理。只使用免费/公开的合成方案，不自动回退到计费模型。
// 客户端只能在服务端定义的方案白名单里选一个，不能指定地址、模型、音色或音频格式。
const { clientKey } = require("../lib/chat-access.cjs");
const { verifyAccess } = require("./chat.js");
const { translateToJapanese } = require("../lib/voice-japanese.cjs");
const { buildSpeechText, buildSpeechProsody, buildPlainSpeech } = require("../lib/voice-delivery.cjs");
const bangstarlight = require("../lib/voice-bangstarlight.cjs");
const FISH_ENDPOINT = "https://api.fish.audio/v1/tts";
const FISH_MODEL = "s2.1-pro-free";
// 站长指定的千早爱音音色，固定使用，避免历史环境变量覆盖。
const VOICE_ID = "c5c17c9709384ba9a4b294662a2af0b1";
const WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 12_000;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

// 语音方案白名单。两条链路都要先经 DeepSeek 把正文转成日语：
//   fish  —— Fish Audio 托管音色，出 mp3，快，可以整条朗读，支持自动朗读。
//   vits2 —— 公开的 Bangstarlight-VITS2 Space，出 wav，无需密钥，但单块（≤120 日文字）
//            实测约 45 秒（含排队），所以只朗读开头并且只用于手动播放。
const PROVIDERS = Object.freeze({
  fish: { name: "Fish Audio", timeoutMs: 60_000, auto: true, configured: (key) => Boolean(key) },
  vits2: { name: "Bangstarlight VITS2", timeoutMs: 75_000, auto: false, configured: () => true },
});
const DEFAULT_PROVIDER = "fish";

const clients = new Map();
let windowStart = 0;
let windowCount = 0;

function header(req, name) {
  const value = req.headers?.[name];
  return typeof value === "string" ? value : "";
}

function sameOrigin(req) {
  try {
    const origin = new URL(header(req, "origin"));
    const protocol = header(req, "x-forwarded-proto").split(",")[0].trim() || (req.socket?.encrypted ? "https" : "http");
    return ["http", "https"].includes(protocol) && origin.origin === `${protocol}://${header(req, "host")}`;
  } catch { return false; }
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readRequest(req) {
  if (Number(header(req, "content-length")) > MAX_BODY_BYTES) throw new Error("body");
  let body = req.body;
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error("body");
    body = JSON.parse(body.toString());
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) throw new Error("body");
  // provider 只允许白名单里的 id；接口、模型、音色与音频格式仍由服务端决定。
  if (Object.keys(body).some((name) => name !== "text" && name !== "provider")) throw new Error("body");
  const provider = body.provider === undefined ? DEFAULT_PROVIDER : body.provider;
  if (typeof provider !== "string" || !Object.hasOwn(PROVIDERS, provider)) throw new Error("provider");
  if (typeof body.text !== "string" || body.text.length > 1000) throw new Error("text");
  const text = body.text.replace(/\[\[(?:smile|wink|shy|surprised|thinking|serious|sad|angry|wave|cheer|cry|pose|neutral)\]\]/g, "").trim();
  if (!text) throw new Error("text");
  return { text, provider };
}

function acquire(req) {
  const now = Date.now();
  if (now - windowStart >= WINDOW_MS) { windowStart = now; windowCount = 0; }
  for (const [key, entry] of clients) if (!entry.active && now - entry.start >= WINDOW_MS) clients.delete(key);
  const key = clientKey(req);
  const entry = clients.get(key) || { start: now, count: 0, active: false };
  if (now - entry.start >= WINDOW_MS) { entry.start = now; entry.count = 0; }
  if (entry.active || entry.count >= 5 || windowCount >= 60) return null;
  entry.active = true;
  entry.count += 1;
  windowCount += 1;
  clients.set(key, entry);
  // 单个热实例的保护措施，并非跨实例的全局费用上限。
  return () => { entry.active = false; };
}

function isMp3(bytes) {
  let offset = 0;
  if (bytes.length >= 10 && bytes.toString("ascii", 0, 3) === "ID3") {
    if (![2, 3, 4].includes(bytes[3]) || bytes[4] === 255 || bytes.subarray(6, 10).some((value) => value & 128)) return false;
    offset = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
    if (bytes[3] === 4 && (bytes[5] & 16)) offset += 10;
  }
  if (bytes.length < offset + 4) return false;
  const a = bytes[offset], b = bytes[offset + 1], c = bytes[offset + 2];
  return a === 255 && (b & 224) === 224 && (b & 24) !== 8 && (b & 6) === 2 && (c >> 4) > 0 && (c >> 4) < 15 && (c & 12) !== 12;
}

// 只根据状态码生成固定诊断，不读取或透传供应商错误正文。
function fishUpstreamFailure(status) {
  const failures = {
    401: ["VOICE_AUTH_FAILED", "语音服务认证失败，请站长检查 Fish Audio 密钥。"],
    403: ["VOICE_ACCESS_DENIED", "语音服务拒绝访问当前模型或音色，请站长检查权限。"],
    402: ["VOICE_CREDIT_REQUIRED", "语音服务要求账户额度或权限，请站长检查 Fish Audio 账户。"],
    404: ["VOICE_NOT_FOUND", "当前爱音音色或语音服务不可用，请站长检查音色配置。"],
    429: ["VOICE_RATE_LIMITED", "语音服务请求较多，请稍后再试。"],
  };
  const [code, error] = failures[status] || ["VOICE_UNAVAILABLE", "爱音语音暂时不可用，请稍后重试；文字聊天仍可使用。"];
  return Object.assign(new Error(error), { code, status: status === 429 ? 429 : 503 });
}

async function synthesizeFish({ text, prosody, key, signal }) {
  const upstream = await fetch(FISH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, model: FISH_MODEL },
    body: JSON.stringify({ text, reference_id: VOICE_ID, format: "mp3", mp3_bitrate: 128, normalize: false, prosody }),
    signal,
    redirect: "error",
  });
  if (signal.aborted) { await upstream.body?.cancel(); throw new Error("aborted"); }
  const mime = upstream.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!upstream.ok) { await upstream.body?.cancel(); throw fishUpstreamFailure(upstream.status); }
  if (!upstream.body || !["audio/mpeg", "audio/mp3", "audio/x-mp3", "application/octet-stream"].includes(mime)) {
    await upstream.body?.cancel();
    throw Object.assign(new Error("invalid-audio"), { code: "VOICE_INVALID_AUDIO" });
  }
  const reader = upstream.body.getReader();
  try {
    if (Number(upstream.headers.get("content-length")) > MAX_AUDIO_BYTES) throw Object.assign(new Error("audio-limit"), { code: "VOICE_INVALID_AUDIO" });
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error("aborted");
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) throw Object.assign(new Error("audio-limit"), { code: "VOICE_INVALID_AUDIO" });
      chunks.push(Buffer.from(value));
    }
    const audio = Buffer.concat(chunks, size);
    if (!isMp3(audio)) throw Object.assign(new Error("invalid-audio"), { code: "VOICE_INVALID_AUDIO" });
    return audio;
  } finally { try { await reader.cancel(); } catch {} }
}

const FAILURE_MESSAGES = {
  VOICE_TRANSLATION_UNAVAILABLE: "日语语音转换暂时不可用，请稍后重试；聊天原文不受影响。",
  VOICE_TRANSLATION_FAILED: "日语语音转换未完成，请稍后重试；聊天原文不受影响。",
  VOICE_INVALID_AUDIO: "语音服务返回的音频无效或不完整，请稍后重试。",
  VOICE_UNAVAILABLE: "语音方案暂时不可用，请稍后重试；文字聊天仍可使用。",
};

module.exports = async function tts(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const key = process.env.FISH_AUDIO_API_KEY?.trim();
  const translationKey = process.env.DEEPSEEK_API_KEY?.trim();
  const translationModel = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash";
  const translationReady = Boolean(translationKey && /^[a-zA-Z0-9._-]{1,80}$/.test(translationModel));
  const providers = Object.entries(PROVIDERS).map(([id, item]) => ({
    id,
    name: item.name,
    language: "ja",
    auto: item.auto,
    available: Boolean(translationReady && item.configured(key)),
  }));
  if (req.method === "GET") {
    return json(res, 200, {
      enabled: providers.some((item) => item.available),
      voiceName: "千早爱音 · AI合成",
      voiceId: VOICE_ID,
      language: "ja",
      providers,
    });
  }
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return json(res, 405, { error: "请求方式不支持。" }); }
  if (!sameOrigin(req)) return json(res, 403, { error: "请从本站播放语音。" });
  if (header(req, "content-type").split(";")[0].trim().toLowerCase() !== "application/json") return json(res, 415, { error: "请使用 JSON 发送朗读内容。" });
  const accessStatus = verifyAccess(req, process.env.CHAT_ACCESS_CODE?.trim() || "");
  if (accessStatus === 429) { res.setHeader("Retry-After", "60"); return json(res, 429, { error: "密码尝试过于频繁，请一分钟后重试。" }); }
  if (accessStatus !== 200) return json(res, 401, { error: "请先解锁 AI 聊天后再播放语音。" });
  let text;
  let provider;
  try { ({ text, provider } = readRequest(req)); } catch { return json(res, 400, { error: "朗读内容格式有误、为空或超过 1000 字，请重试。" }); }
  const spec = PROVIDERS[provider];
  // 两条链路都要 DeepSeek 先把正文转成日语，因此它先判。
  if (!translationReady) return json(res, 503, { code: "VOICE_TRANSLATION_UNAVAILABLE", error: "日语语音转换尚未接通，请站长检查 DeepSeek 配置；聊天原文不受影响。" });
  if (!spec.configured(key)) return json(res, 503, { code: "VOICE_NOT_CONFIGURED", error: "该语音方案尚未配置，请站长检查密钥；文字聊天仍可使用。" });
  if (req.aborted || res.destroyed) return;
  const release = acquire(req);
  if (!release) { res.setHeader("Retry-After", "60"); return json(res, 429, { error: "语音正在生成或请求较多，请稍后再试。" }); }

  const controller = new AbortController();
  let disconnected = false;
  let timedOut = false;
  const disconnect = () => { disconnected = true; controller.abort(); };
  const onClose = () => { if (!res.writableEnded) disconnect(); };
  req.on?.("aborted", disconnect);
  req.on?.("error", disconnect);
  res.on?.("close", onClose);
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, spec.timeoutMs);
  const canReply = () => !disconnected && !res.writableEnded && !res.destroyed;
  let failureCode = "VOICE_NETWORK_ERROR";
  try {
    const plan = await translateToJapanese(text, { key: translationKey, model: translationModel, signal: controller.signal });
    let audio;
    let mime;
    let truncated = false;
    if (provider === "fish") {
      audio = await synthesizeFish({ text: buildSpeechText(plan), prosody: buildSpeechProsody(plan), key, signal: controller.signal });
      mime = "audio/mpeg";
    } else {
      const speech = buildPlainSpeech(plan);
      truncated = speech.truncated;
      // 该 Space 不认 Fish 的控制标记，只接收纯日语文本与一段情感提示。
      audio = await bangstarlight.synthesize({
        text: speech.text,
        emotion: speech.emotion,
        lengthScale: speech.lengthScale,
        styleWeight: speech.styleWeight,
        signal: controller.signal,
      });
      mime = "audio/wav";
    }
    if (!canReply()) return;
    res.statusCode = 200;
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Language", "ja");
    res.setHeader("Content-Length", String(audio.length));
    if (truncated) res.setHeader("X-Voice-Truncated", "1");
    res.end(audio);
  } catch (error) {
    if (error?.status) {
      if (!canReply()) return;
      if (error.status === 429) res.setHeader("Retry-After", "60");
      return json(res, error.status, { code: error.code, error: error.message });
    }
    if (error?.code && Object.hasOwn(FAILURE_MESSAGES, error.code)) failureCode = error.code;
    if (canReply()) json(res, timedOut ? 504 : 503, {
      code: timedOut ? "VOICE_TIMEOUT" : failureCode,
      error: timedOut
        ? (provider === "vits2" ? "语音方案排队较久，请稍后重试。" : "语音生成等待较久，请稍后重试。")
        : FAILURE_MESSAGES[failureCode] || "暂时无法连接语音服务，请稍后重试；文字聊天仍可使用。",
    });
  } finally {
    clearTimeout(timeout);
    controller.abort();
    req.off?.("aborted", disconnect);
    req.off?.("error", disconnect);
    res.off?.("close", onClose);
    release();
  }
};
