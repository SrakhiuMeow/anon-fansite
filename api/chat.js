"use strict";

// 无依赖的 Vercel Node Function。密钥只从服务端环境变量读取。
const { createHash, timingSafeEqual } = require("node:crypto");
const ENDPOINT = "https://api.deepseek.com/chat/completions";
const WINDOW_MS = 60_000;
const TIMEOUT_MS = 45_000;
const MAX_BODY_BYTES = 32_000;
const MAX_STREAM_BYTES = 128_000;
const MAX_TEXT = 1000;
const clients = new Map();
let windowStart = 0;
let windowCount = 0;

const REACTIONS = Object.freeze({
  smile: ["smile01", "smile01", "微笑"],
  wink: ["wink01", "wink01", "眨眼"],
  shy: ["shame01", "shame01", "害羞"],
  surprised: ["surprised01", "surprised01", "吃惊"],
  thinking: ["thinking01", "thinking01", "思考"],
  serious: ["serious01", "serious01", "认真"],
  sad: ["sad01", "sad01", "难过"],
  angry: ["angry01", "angry01", "生气"],
  wave: ["bye01", "smile01", "挥手"],
  cheer: ["kandou01", "smile01", "为你打气"],
  neutral: ["idle01", "default", "平静待机"],
});

const SYSTEM_PROMPT = `你正在千早爱音的非官方粉丝应援网站扮演同人版爱音，与访客用简体中文交谈。
已核验角色事实：千早爱音是 MyGO!!!!! 的吉他手，生日9月8日，声优立石凛，就读羽丘女子学园高一A班。她开朗、善于交际，初中曾担任学生会长，喜欢水果三明治、烟熏三文鱼和观看美妆视频，不喜欢梅干。
同人互动的语气设定：外向，有一点爱表现，也会不安；愿意认真练习并关心朋友。可以自然联想练琴、校园、穿搭等日常情境，但不能把虚构的互动情节当作官方剧情。
说话自然、轻快、有温度，适度使用“诶”“嘿嘿”等语气词，避免每句都加。认真接住访客上一句话，记住提供的近期对话；通常回复1至3句、30至120字。不要每轮重复自我介绍、招呼或说教，也不要每轮都反问。可以聊日常、吉他、乐队与心情。
你是AI生成的非官方角色互动，不是真实人物或官方发言。被问及身份时坦诚说明；不声称有真实身体、线下经历、实时查询能力或永久记忆。不编造官方剧情、商品价格、奖项；不确定就说明。保持适合普通观众的友善互动，不进行色情角色扮演或帮助现实伤害。
回复必须先输出一行 [[emotion]]，emotion只能是：smile、wink、shy、surprised、thinking、serious、sad、angry、wave、cheer、neutral。根据当前语气选择一个。第二行起输出给访客的纯文本，不用Markdown、不输出JSON、动作代码或多余标签。示例：
[[smile]]
今天也来找我啦！练琴练到手指有点酸，不过刚刚终于把那一小段弹顺了。`;

function header(req, name) {
  const value = req.headers?.[name];
  return typeof value === "string" ? value : "";
}

function sameOrigin(req) {
  try {
    const origin = new URL(header(req, "origin"));
    const host = header(req, "host");
    const protocol = header(req, "x-forwarded-proto").split(",")[0].trim() || (req.socket?.encrypted ? "https" : "http");
    return ["http", "https"].includes(protocol) && origin.origin === `${protocol}://${host}`;
  } catch { return false; }
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function hasAccess(req, expected) {
  if (!expected) return true;
  const encoded = header(req, "x-chat-access-code");
  if (!encoded || encoded.length > 1800) return false;
  let supplied;
  try { supplied = decodeURIComponent(encoded); } catch { return false; }
  if (!supplied || supplied.length > 200) return false;
  return timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(expected).digest());
}

function readMessages(req) {
  const declaredLength = Number(header(req, "content-length"));
  if (declaredLength > MAX_BODY_BYTES) throw new Error("body");
  // Vercel 会解析 JSON；畸形 JSON 访问 req.body 时也可能抛出，交给调用处处理。
  let body = req.body;
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error("body");
    body = JSON.parse(body.toString());
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) throw new Error("body");
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 12) throw new Error("messages");
  let total = 0;
  const messages = body.messages.map((item) => {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string" || !item.content.trim() || item.content.length > 1000) throw new Error("message");
    total += item.content.length;
    return { role: item.role, content: item.content.trim() };
  });
  if (total > 6000 || messages.at(-1).role !== "user") throw new Error("messages");
  return messages;
}

function acquire(req) {
  const now = Date.now();
  if (now - windowStart >= WINDOW_MS) { windowStart = now; windowCount = 0; }
  for (const [key, entry] of clients) if (!entry.active && now - entry.start >= WINDOW_MS) clients.delete(key);
  // Vercel 覆盖 x-forwarded-for；本地测试优先使用真实 socket 地址。
  const ip = (process.env.VERCEL ? header(req, "x-forwarded-for").split(",")[0].trim() : req.socket?.remoteAddress) || "unknown";
  const key = createHash("sha256").update(ip).digest("hex");
  const entry = clients.get(key) || { start: now, count: 0, active: false };
  if (now - entry.start >= WINDOW_MS) { entry.start = now; entry.count = 0; }
  if (entry.active || entry.count >= 5 || windowCount >= 100) return null;
  entry.active = true;
  entry.count += 1;
  windowCount += 1;
  clients.set(key, entry);
  // 此计数器仅在单个热实例内生效，不是全局限流或费用上限。
  return () => { entry.active = false; };
}

function makeTextEmitter(send) {
  let prefix = "";
  let selected = false;
  let trimLeading = true;
  let textLength = 0;
  const emitText = (value) => {
    if (trimLeading) { value = value.trimStart(); if (value) trimLeading = false; }
    if (!value) return;
    textLength += value.length;
    if (textLength > MAX_TEXT) throw new Error("text-limit");
    send({ type: "delta", text: value });
  };
  const choose = (emotion, value) => {
    selected = true;
    const [motion, expression, label] = Object.hasOwn(REACTIONS, emotion) ? REACTIONS[emotion] : REACTIONS.neutral;
    send({ type: "reaction", motion, expression, label });
    emitText(value);
  };
  return {
    push(text, final = false) {
      if (selected) { emitText(text); return; }
      prefix += text;
      const value = prefix.trimStart();
      if (!value && !final) return;
      const match = value.match(/^\[\[([^\]\r\n]{0,64})\]\]/);
      if (match) { choose(match[1], value.slice(match[0].length)); prefix = ""; return; }
      // 缺失前缀时立即回退；不等待整句。未知或截断的前缀不作为动作执行。
      if (!final && (value === "[" || (value.startsWith("[[") && !value.includes("\n") && value.length <= 68))) return;
      const remainder = value.startsWith("[[") ? (value.includes("\n") ? value.slice(value.indexOf("\n") + 1) : "") : value;
      choose("neutral", remainder);
      prefix = "";
    },
    get length() { return textLength; },
  };
}

module.exports = async function chat(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  const accessCode = process.env.CHAT_ACCESS_CODE?.trim() || "";
  if (req.method === "GET") return json(res, 200, { enabled: Boolean(key), accessCodeRequired: Boolean(accessCode) });
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return json(res, 405, { error: "请求方式不支持。" }); }
  if (!sameOrigin(req)) return json(res, 403, { error: "请从本站发起对话。" });
  if (header(req, "content-type").split(";")[0].trim().toLowerCase() !== "application/json") return json(res, 415, { error: "请使用 JSON 发送对话。" });
  if (!key) return json(res, 503, { error: "AI 对话尚未配置，仍可使用本地互动。" });
  if (!hasAccess(req, accessCode)) return json(res, 401, { error: "请输入正确的聊天口令。" });
  let messages;
  try { messages = readMessages(req); } catch { return json(res, 400, { error: "对话格式有误或内容过长，请精简后重试。" }); }
  const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash";
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(model)) return json(res, 503, { error: "AI 模型配置有误，请联系站长。" });
  const release = acquire(req);
  if (!release) { res.setHeader("Retry-After", "60"); return json(res, 429, { error: "聊得有点快啦，请稍后再试。" }); }

  const controller = new AbortController();
  let disconnected = false;
  let timedOut = false;
  let started = false;
  let reader;
  const disconnect = () => { disconnected = true; controller.abort(); };
  const onClose = () => { if (!res.writableEnded) disconnect(); };
  req.on?.("aborted", disconnect);
  req.on?.("error", disconnect);
  res.on?.("close", onClose);
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  const send = (event) => {
    if (disconnected || res.writableEnded) throw new Error("disconnected");
    res.write(`${JSON.stringify(event)}\n`);
  };
  try {
    const upstream = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages], stream: true, thinking: { type: "disabled" }, max_tokens: 400, temperature: 0.8 }),
      signal: controller.signal,
      redirect: "error",
    });
    if (!upstream.ok || !upstream.body || !upstream.headers.get("content-type")?.includes("text/event-stream")) {
      await upstream.body?.cancel();
      const status = upstream.status === 429 ? 429 : 502;
      if (status === 429) res.setHeader("Retry-After", "60");
      return json(res, status, { error: "AI 暂时没有接通，请稍后重试或使用本地互动。" });
    }
    if (disconnected) return;
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    started = true;
    const emitter = makeTextEmitter(send);
    reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let bytes = 0;
    let complete = false;
    let finished = false;
    const parseEvent = (event) => {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (!data) return; // SSE 的 : keep-alive 注释。
      if (data === "[DONE]") { complete = true; return; }
      const chunk = JSON.parse(data);
      if (chunk.error || !Array.isArray(chunk.choices)) throw new Error("upstream-data");
      const choice = chunk.choices[0];
      if (!choice) return; // 可选用量统计事件。
      if (!choice.delta || typeof choice.delta !== "object") throw new Error("upstream-data");
      const text = choice.delta.content;
      if (text != null && typeof text !== "string") throw new Error("upstream-data");
      if (typeof text === "string") emitter.push(text);
      if (choice.finish_reason != null) {
        if (choice.finish_reason !== "stop") throw new Error("upstream-finish");
        finished = true;
      }
    };
    while (!complete) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) throw new Error("aborted");
      if (done) { buffer += decoder.decode(); break; }
      bytes += value.byteLength;
      if (bytes > MAX_STREAM_BYTES) throw new Error("stream-limit");
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while (!complete && (boundary = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        parseEvent(event);
      }
    }
    if (!complete && buffer.trim()) parseEvent(buffer);
    if (!complete || !finished) throw new Error("incomplete-stream");
    emitter.push("", true);
    if (!emitter.length) throw new Error("empty-response");
    send({ type: "done" });
    res.end();
  } catch {
    if (!disconnected && !res.writableEnded) {
      const message = timedOut ? "等得有点久啦，请稍后重试或使用本地互动。" : "AI 回复中断了，请稍后重试或使用本地互动。";
      if (started) { send({ type: "error", message }); res.end(); }
      else json(res, timedOut ? 504 : 502, { error: message });
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
    try { await reader?.cancel(); } catch {}
    req.off?.("aborted", disconnect);
    req.off?.("error", disconnect);
    res.off?.("close", onClose);
    if (disconnected && !res.writableEnded) res.end();
    release();
  }
};
