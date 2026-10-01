"use strict";

// 无依赖的语音代理。只使用免费开发模型，不自动回退到计费模型。
const { clientKey } = require("../lib/chat-access.cjs");
const { verifyAccess } = require("./chat.js");
const ENDPOINT = "https://api.fish.audio/v1/tts";
const MODEL = "s2.1-pro-free";
const DEFAULT_VOICE = "c5c17c9709384ba9a4b294662a2af0b1";
const WINDOW_MS = 60_000;
const TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 12_000;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
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

function readText(req) {
  if (Number(header(req, "content-length")) > MAX_BODY_BYTES) throw new Error("body");
  let body = req.body;
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error("body");
    body = JSON.parse(body.toString());
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) throw new Error("body");
  // 客户端不能指定接口、模型、音色、音频格式或提供参考音频。
  if (Object.keys(body).some((name) => name !== "text") || typeof body.text !== "string" || body.text.length > 1000) throw new Error("text");
  const text = body.text.replace(/\[\[(?:smile|wink|shy|surprised|thinking|serious|sad|angry|wave|cheer|cry|pose|neutral)\]\]/g, "").trim();
  if (!text) throw new Error("text");
  return text;
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

module.exports = async function tts(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const key = process.env.FISH_AUDIO_API_KEY?.trim();
  const voice = process.env.FISH_AUDIO_VOICE_ID?.trim() || DEFAULT_VOICE;
  const enabled = Boolean(key && /^[a-f0-9]{32}$/i.test(voice));
  if (req.method === "GET") return json(res, 200, { enabled, voiceName: "千早爱音 · AI合成" });
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return json(res, 405, { error: "请求方式不支持。" }); }
  if (!sameOrigin(req)) return json(res, 403, { error: "请从本站播放语音。" });
  if (header(req, "content-type").split(";")[0].trim().toLowerCase() !== "application/json") return json(res, 415, { error: "请使用 JSON 发送朗读内容。" });
  const accessStatus = verifyAccess(req, process.env.CHAT_ACCESS_CODE?.trim() || "");
  if (accessStatus === 429) { res.setHeader("Retry-After", "60"); return json(res, 429, { error: "密码尝试过于频繁，请一分钟后重试。" }); }
  if (accessStatus !== 200) return json(res, 401, { error: "请先解锁 AI 聊天后再播放语音。" });
  if (!enabled) return json(res, 503, { error: "爱音语音尚未配置，请联系站长；文字聊天仍可使用。" });
  let text;
  try { text = readText(req); } catch { return json(res, 400, { error: "朗读内容格式有误、为空或超过 1000 字，请重试。" }); }
  if (req.aborted || res.destroyed) return;
  const release = acquire(req);
  if (!release) { res.setHeader("Retry-After", "60"); return json(res, 429, { error: "语音正在生成或请求较多，请稍后再试。" }); }

  const controller = new AbortController();
  let disconnected = false;
  let timedOut = false;
  let reader;
  const cancelReader = () => { reader?.cancel().catch(() => {}); };
  controller.signal.addEventListener("abort", cancelReader, { once: true });
  const disconnect = () => { disconnected = true; controller.abort(); };
  const onClose = () => { if (!res.writableEnded) disconnect(); };
  req.on?.("aborted", disconnect);
  req.on?.("error", disconnect);
  res.on?.("close", onClose);
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  const canReply = () => !disconnected && !res.writableEnded && !res.destroyed;
  try {
    const upstream = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, model: MODEL },
      body: JSON.stringify({ text, reference_id: voice, format: "mp3", mp3_bitrate: 128, normalize: true }),
      signal: controller.signal,
      redirect: "error",
    });
    if (controller.signal.aborted) { await upstream.body?.cancel(); throw new Error("aborted"); }
    const mime = upstream.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!upstream.ok || !upstream.body || !["audio/mpeg", "audio/mp3", "audio/x-mp3", "application/octet-stream"].includes(mime)) {
      await upstream.body?.cancel();
      if (!canReply()) return;
      const status = upstream.status === 429 ? 429 : 502;
      if (status === 429) res.setHeader("Retry-After", "60");
      return json(res, status, { error: "爱音语音暂时不可用，请稍后重试；文字聊天仍可使用。" });
    }
    reader = upstream.body.getReader();
    if (Number(upstream.headers.get("content-length")) > MAX_AUDIO_BYTES) throw new Error("audio-limit");
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) throw new Error("aborted");
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) throw new Error("audio-limit");
      chunks.push(Buffer.from(value));
    }
    const audio = Buffer.concat(chunks, size);
    if (!isMp3(audio)) throw new Error("invalid-audio");
    if (!canReply()) return;
    res.statusCode = 200;
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(audio.length));
    res.end(audio);
  } catch {
    if (canReply()) json(res, timedOut ? 504 : 502, { error: timedOut ? "语音生成等待较久，请稍后重试。" : "语音生成中断了，请稍后重试；文字聊天仍可使用。" });
  } finally {
    clearTimeout(timeout);
    controller.abort();
    try { await reader?.cancel(); } catch {}
    controller.signal.removeEventListener("abort", cancelReader);
    req.off?.("aborted", disconnect);
    req.off?.("error", disconnect);
    res.off?.("close", onClose);
    release();
  }
};
