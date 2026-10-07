"use strict";

// Bangstarlight-VITS2（Hugging Face Space）语音合成客户端。
// 该 Space 是公开的免费推理队列：没有 API Key，也没有可用性承诺，排队时间由所有人共享。
// 协议是 Gradio 队列三段式：/queue/join → /queue/data(SSE) → /file=<path> 下载 wav。
// 单块（≤120 日文字）实测约 8–50 秒，所以调用方只提交单块短文本，不做多块拼接。
const SPACE = "https://mahiruoshi-bangstarlight-vits2.hf.space";
// Space 的下拉框取值，Multi-speaker BanG Dream 模型里的千早爱音。
const SPEAKER = "愛音";
const FN_INFER = 1;
const TRIGGER_ID = FN_INFER + 6;
const JOIN_TIMEOUT_MS = 15_000;
const RESULT_TIMEOUT_MS = 65_000;
const DOWNLOAD_TIMEOUT_MS = 25_000;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_SSE_BYTES = 256 * 1024;
// Space 返回形如 /tmp/gradio/<hash>/audio.wav 的服务端路径。
// 允许一个开头斜杠，其余必须是单词字符/点/斜杠/连字符，借此挡掉 //host、协议与 .. 之类。
const REMOTE_PATH = /^\/?[\w][\w./-]{0,299}$/;

function failure(code) {
  const error = new Error("bangstarlight");
  error.code = code;
  return error;
}

// 每一步都有自己的超时，同时跟随调用方的 signal（断连或整体超时）。
function step(limitMs, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limitMs);
  const relay = () => controller.abort();
  signal?.addEventListener("abort", relay, { once: true });
  if (signal?.aborted) controller.abort();
  return {
    signal: controller.signal,
    release() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", relay);
    },
  };
}

function isWav(bytes) {
  return bytes.length >= 44 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
}

async function readLimited(body, limit, signal) {
  if (!body?.getReader) throw failure("VOICE_INVALID_AUDIO");
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw failure("VOICE_ABORTED");
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw failure("VOICE_INVALID_AUDIO");
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { await reader.cancel(); } catch {}
  }
  return Buffer.concat(chunks, size);
}

async function joinQueue(payload, sessionHash, signal) {
  const guard = step(JOIN_TIMEOUT_MS, signal);
  try {
    const response = await fetch(`${SPACE}/queue/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: payload, event_data: null, fn_index: FN_INFER, trigger_id: TRIGGER_ID, session_hash: sessionHash, api_name: "infer" }),
      signal: guard.signal,
      redirect: "error",
    });
    if (!response.ok) { await response.body?.cancel(); throw failure("VOICE_UNAVAILABLE"); }
    const result = await response.json();
    if (!result?.event_id) throw failure("VOICE_UNAVAILABLE");
    return result.event_id;
  } catch (error) {
    if (error?.code) throw error;
    throw failure(guard.signal.aborted ? "VOICE_TIMEOUT" : "VOICE_UNAVAILABLE");
  } finally { guard.release(); }
}

async function waitForResult(sessionHash, signal) {
  const guard = step(RESULT_TIMEOUT_MS, signal);
  let reader;
  try {
    const response = await fetch(`${SPACE}/queue/data?session_hash=${encodeURIComponent(sessionHash)}`, {
      headers: { Accept: "text/event-stream" },
      signal: guard.signal,
      redirect: "error",
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw failure("VOICE_UNAVAILABLE"); }
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (guard.signal.aborted) throw failure("VOICE_TIMEOUT");
      if (done) break;
      size += value.byteLength;
      // 事件里可能有排队进度和大段 base64；超过上限说明不是我们预期的流。
      if (size > MAX_SSE_BYTES) throw failure("VOICE_INVALID_AUDIO");
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line.startsWith("data:")) continue;
        let message;
        try { message = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (message?.msg !== "process_completed") continue;
        // Space 关闭了 show_error，失败时只回 {"error": null}，拿不到堆栈。
        if (!message.success) throw failure("VOICE_UNAVAILABLE");
        const remote = message.output?.data?.[0]?.path;
        if (typeof remote !== "string" || !REMOTE_PATH.test(remote)) throw failure("VOICE_INVALID_AUDIO");
        // 路径同样是 Space 所在主机；保留开头的斜杠，Space 只接受 /file=/tmp/... 这种形式。
        // REMOTE_PATH 已经挡掉了 //host 与带协议的写法。
        return `${SPACE}/file=${remote}`;
      }
    }
    throw failure("VOICE_TIMEOUT");
  } catch (error) {
    if (error?.code) throw error;
    throw failure(guard.signal.aborted ? "VOICE_TIMEOUT" : "VOICE_UNAVAILABLE");
  } finally {
    guard.release();
    try { await reader?.cancel(); } catch {}
  }
}

async function download(url, signal) {
  const guard = step(DOWNLOAD_TIMEOUT_MS, signal);
  try {
    const response = await fetch(url, { signal: guard.signal, redirect: "error" });
    if (!response.ok) { await response.body?.cancel(); throw failure("VOICE_UNAVAILABLE"); }
    if (Number(response.headers.get("content-length")) > MAX_AUDIO_BYTES) { await response.body?.cancel(); throw failure("VOICE_INVALID_AUDIO"); }
    const audio = await readLimited(response.body, MAX_AUDIO_BYTES, guard.signal);
    if (!isWav(audio)) throw failure("VOICE_INVALID_AUDIO");
    return audio;
  } catch (error) {
    if (error?.code) throw error;
    throw failure(guard.signal.aborted ? "VOICE_TIMEOUT" : "VOICE_UNAVAILABLE");
  } finally { guard.release(); }
}

// 合成单块日语文本，返回 wav 字节。各参数与 Space 的 /infer 输入一一对应。
async function synthesize({ text, emotion = "", lengthScale = 1, styleWeight = 1, signal }) {
  if (typeof text !== "string" || !text.trim()) throw failure("VOICE_INVALID_AUDIO");
  const sessionHash = Math.random().toString(36).slice(2, 13);
  const payload = [
    text, 0.5, 0.6, 0.8, lengthScale, SPEAKER,
    emotion, null, false, false, emotion, styleWeight,
  ];
  await joinQueue(payload, sessionHash, signal);
  const url = await waitForResult(sessionHash, signal);
  return download(url, signal);
}

module.exports = { synthesize, SPACE, SPEAKER };
