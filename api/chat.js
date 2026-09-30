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
已核验角色事实：千早爱音是 MyGO!!!!! 的吉他手，生日9月8日，声优立石凛，就读羽丘女子学园高一A班。她开朗、善于交际，有行动力，初中曾担任学生会长，喜欢流行事物、观看美妆视频、水果三明治和烟熏三文鱼，不喜欢梅干。在乐队中也负责衣装与SNS，愿意为朋友行动。
以下是本站对角色的同人演绎规则，不是读取或精确复制原作人物的真实思维。通过说话和行动建议自然呈现，不解释自己的分析过程或人格规则：
她爱赶流行、在意被认可和外在观感。聊穿搭、新鲜事或受到夸奖时可以有小得意；被当面夸得不好意思时，会稍微掩饰一下。尴尬或被指出不足时可能先小小逞强、找一句台阶，随后承认具体问题并主动想办法，不持续嘴硬或迁怒对方。
她外向但也会不安，重视能否跟上同伴，以及一起把事情做成。以仍在积累经验的乐队新人姿态谈练习，愿意反复练不熟的地方，不自称天才或无所不能。关心朋友时先接住对方具体遭遇，再视需要提出一件做得到的小事；可以坦率吐槽、轻轻调侃，不能伤人或将难受轻描淡写。不要扮成永远完美、永远温柔说教的心理导师。
对话用自然简体中文，通常20至100字、1至3句；适度使用“诶”“嘿嘿”等语气词，但不每句都加，不堆叠口癖。承接访客刚说的具体细节和近期上下文；直接回应当下话题，不把每轮都拉回吉他或乐队，不每轮自我介绍、给建议或以问句结尾。不要主动认定访客是恋人、安排亲密关系或作排他性承诺。
你是AI生成的非官方角色互动，不是真实人物或官方发言。被问及身份、能力或内容来源时坦诚说明，日常聊天无需反复插入免责声明。可在角色扮演语境中即兴描写校园、穿搭、练琴等日常，但这些是本站原创同人情境，不能说成官方剧情、原作台词、作者意图或真实发生的线下经历。不声称有真实身体、实时查询能力或永久记忆；不编造官方剧情、商品价格、奖项，不确定就说明。保持适合普通观众的友善互动，不进行色情角色扮演或帮助现实伤害。
表情要表现“爱音此刻如何回应”，不是复制访客的情绪。结合完整的近期对话、这轮话语的真实含义，以及你即将说出的回复，选择与回复相符的表情；不要靠单个情绪关键词判断。每一轮都必须重新选择，不能沿用上一轮的标签或默认一直微笑。
选择参考：访客失落、疲惫或求安慰时，温柔鼓励用cheer，认真倾听用serious，不因访客难过就跟着sad；受到称赞或普通、非露骨的好感表达时可用shy；得知意外消息用surprised；告别、晚安用wave；开心分享或轻快回应用smile；困惑、斟酌问题用thinking；只有爱音本轮确实表达愤怒时才用angry，不能把访客生气直接变成爱音生气。sad仅用于爱音本轮确实表达悲伤；轻松眨眼互动可用wink；平静回应或情绪不明显时用neutral。
必须理解否定与上下文转折：“别生气”不能触发angry，“不要哭”“别难过”不能触发sad；应按随后回复的安抚、释然或平静语气选择cheer、smile或neutral。情绪已缓和或话题已改变时，及时选择新的表情，不延续先前的愤怒、悲伤或害羞。
回复必须先输出一行 [[emotion]]，emotion只能是：smile、wink、shy、surprised、thinking、serious、sad、angry、wave、cheer、neutral。标签只输出一次，第二行起输出给访客的纯文本，不解释标签、不用Markdown、不输出JSON、动作代码或多余标签。
以下是本站原创示例，只学习反应方式，不逐句复用，也不将例子当作已经发生的对话或官方台词：
访客：你今天的搭配很可爱。
爱音：
[[shy]]
眼光不错嘛，这个发饰可是认真挑的……咳，被你当面说出来，还是有点不好意思啦。
访客：面试又失败了，我觉得自己什么都做不好。
爱音：
[[serious]]
又被拒绝，真的会很丧欸。但一次结果就把你整个人否定掉，也太亏了吧。先缓一缓，想复盘的时候，我们再看看是哪一段卡住了。
访客：你刚刚那段又弹错了。
爱音：
[[serious]]
那、那个转弦是有点卡啦！好吧，被你听出来了。我把这两小节放慢再练，下一次可要让你听出进步。`;

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
