"use strict";

// 调用真实 handler、仅替换 fetch；不需要 API Key，不发出付费请求。
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const handlerPath = path.resolve(__dirname, "../api/chat.js");
const originalFetch = global.fetch;
const TEST_CODE = "only-for-tests";
const originalEnv = { key: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL, code: process.env.CHAT_ACCESS_CODE, vercel: process.env.VERCEL };
let checks = 0;
let networkCalls = 0;

function freshHandler() { delete require.cache[handlerPath]; return require(handlerPath); }
function request(options = {}) {
  const req = new EventEmitter();
  req.method = options.method || "POST";
  req.headers = { host: "anon.example", origin: "https://anon.example", "x-forwarded-proto": "https", "content-type": "application/json", "x-chat-access-code": TEST_CODE, ...options.headers };
  req.body = options.body === undefined ? { messages: [{ role: "user", content: "你好，今天练琴怎么样？" }] } : options.body;
  req.socket = { remoteAddress: options.ip || "192.0.2.1" };
  return req;
}
function response() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.body = "";
  res.writableEnded = false;
  res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; };
  res.flushHeaders = () => {};
  res.write = (chunk) => { res.body += chunk; return true; };
  res.end = (chunk = "") => { res.body += chunk; res.writableEnded = true; };
  return res;
}
async function call(handler, options) {
  const req = request(options);
  const res = response();
  await handler(req, res);
  return res;
}
const chunk = (content, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\r\n\r\n`;
const sse = (text = "[[smile]]\n今天终于把那一小段弹顺了！") => `: keep-alive\r\n\r\n${chunk(text)}${chunk(null, "stop")}data: [DONE]\r\n\r\n`;
function streamed(raw) {
  const bytes = new TextEncoder().encode(raw);
  // 刻意拆开中文 UTF-8、SSE 分隔符与 JSON，检查增量解析。
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      const end = Math.min(bytes.length, offset + [1, 2, 7, 13][offset % 4]);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  }), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}
function mockFetch(factory = () => streamed(sse())) {
  global.fetch = async (...args) => { networkCalls += 1; return factory(...args); };
}
const events = (res) => res.body.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const text = (res) => events(res).filter((event) => event.type === "delta").map((event) => event.text).join("");
async function test(name, run) { await run(); checks += 1; console.log(`通过：${name}`); }

(async () => {
  delete process.env.VERCEL;
  delete process.env.DEEPSEEK_MODEL;
  process.env.CHAT_ACCESS_CODE = TEST_CODE;
  process.env.DEEPSEEK_API_KEY = "test-key-never-public";
  mockFetch();

  await test("GET 仅返回开关状态；密钥、聊天口令不泄漏", async () => {
    process.env.CHAT_ACCESS_CODE = "private-code";
    const before = networkCalls;
    const res = await call(freshHandler(), { method: "GET" });
    assert.deepEqual(JSON.parse(res.body), { enabled: true, accessCodeRequired: true });
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(networkCalls, before);
    assert.ok(!res.body.includes(process.env.DEEPSEEK_API_KEY) && !res.body.includes(process.env.CHAT_ACCESS_CODE));
    process.env.CHAT_ACCESS_CODE = TEST_CODE;
  });

  await test("未配置密钥返回 503，状态可供前端回退", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const handler = freshHandler();
    const before = networkCalls;
    assert.equal((await call(handler)).statusCode, 503);
    assert.equal(JSON.parse((await call(handler, { method: "GET" })).body).enabled, false);
    assert.equal(networkCalls, before);
    process.env.DEEPSEEK_API_KEY = "test-key-never-public";
  });

  await test("拒绝跨域、缺失 Origin、错误类型及请求方式", async () => {
    const handler = freshHandler();
    const before = networkCalls;
    for (const origin of ["https://evil.example", "https://anon.example.evil", "http://anon.example", "", "null"]) assert.equal((await call(handler, { headers: { origin } })).statusCode, 403);
    assert.equal((await call(handler, { headers: { "content-type": "text/plain" } })).statusCode, 415);
    assert.equal((await call(handler, { method: "DELETE" })).statusCode, 405);
    assert.equal(networkCalls, before);
  });

  await test("聊天口令匹配后才允许请求，拒绝超长口令", async () => {
    process.env.CHAT_ACCESS_CODE = "only-for-tests";
    const handler = freshHandler();
    const before = networkCalls;
    for (const value of ["", "wrong", "x".repeat(201), "x".repeat(1801)]) assert.equal((await call(handler, { headers: { "x-chat-access-code": value } })).statusCode, 401);
    assert.equal(networkCalls, before);
    assert.equal((await call(handler, { headers: { "x-chat-access-code": "only-for-tests" } })).statusCode, 200);
    process.env.CHAT_ACCESS_CODE = TEST_CODE;
  });

  await test("聊天口令支持编码后的中文与特殊字符，拒绝坏编码", async () => {
    const code = "爱音🎸 MyGO! 100%+";
    process.env.CHAT_ACCESS_CODE = `  ${code}  `;
    const handler = freshHandler();
    const before = networkCalls;
    for (const value of ["%", "%GG", "%E4%B8", "%ED%A0%80", encodeURIComponent("音".repeat(201))]) {
      assert.equal((await call(handler, { headers: { "x-chat-access-code": value } })).statusCode, 401);
    }
    assert.equal(networkCalls, before);
    const res = await call(freshHandler(), { headers: { "x-chat-access-code": encodeURIComponent(code) } });
    assert.equal(res.statusCode, 200);
    assert.equal(events(res).at(-1).type, "done");
    assert.ok(!res.body.includes(code) && !res.body.includes(encodeURIComponent(code)));
    process.env.CHAT_ACCESS_CODE = " ";
    assert.equal(JSON.parse((await call(handler, { method: "GET" })).body).accessCodeRequired, true);
    process.env.CHAT_ACCESS_CODE = TEST_CODE;
  });

  await test("未配置或空白覆盖口令仍强制锁定，缺失和错误密码不能绕过", async () => {
    const before = networkCalls;
    for (const override of [undefined, "", " "]) {
      if (override === undefined) delete process.env.CHAT_ACCESS_CODE;
      else process.env.CHAT_ACCESS_CODE = override;
      const handler = freshHandler();
      assert.deepEqual(JSON.parse((await call(handler, { method: "GET" })).body), { enabled: true, accessCodeRequired: true });
      for (const code of ["", "wrong"]) {
        for (const body of [{ action: "unlock" }, { messages: [{ role: "user", content: "你好" }] }]) {
          assert.equal((await call(handler, { body, headers: { "x-chat-access-code": code } })).statusCode, 401);
        }
      }
    }
    assert.equal(networkCalls, before);
    process.env.CHAT_ACCESS_CODE = TEST_CODE;
  });

  await test("正确密码只解锁不调用模型，后续聊天仍需密码且不传给模型", async () => {
    const handler = freshHandler();
    const before = networkCalls;
    const res = await call(handler, { body: JSON.stringify({ action: "unlock" }) });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { unlocked: true });
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(networkCalls, before);
    assert.equal((await call(handler, { body: { action: "unlock" }, headers: { "x-chat-access-code": "wrong" } })).statusCode, 401);
    assert.equal((await call(handler, { headers: { "x-chat-access-code": "" } })).statusCode, 401);
    assert.equal((await call(handler, { body: { action: "unknown" } })).statusCode, 400);
    assert.equal((await call(handler, { body: { action: "unlock", junk: "x".repeat(33000) } })).statusCode, 400);
    assert.equal(networkCalls, before);
    mockFetch((url, options) => {
      assert.ok(!JSON.stringify(options.headers).includes(TEST_CODE));
      assert.ok(!options.body.includes(TEST_CODE));
      return streamed(sse());
    });
    assert.equal((await call(handler)).statusCode, 200);
    mockFetch();
  });

  await test("连续错误密码限流且窗口恢复，成功解锁不消耗聊天次数", async () => {
    const handler = freshHandler();
    const realNow = Date.now;
    let now = realNow();
    const before = networkCalls;
    Date.now = () => now;
    try {
      for (let i = 0; i < 5; i++) assert.equal((await call(handler, { body: { action: "unlock" }, headers: { "x-chat-access-code": "wrong" } })).statusCode, 401);
      const blocked = await call(handler, { body: { action: "unlock" } });
      assert.equal(blocked.statusCode, 429);
      assert.equal(blocked.headers["retry-after"], "60");
      assert.equal((await call(handler, { body: { action: "unlock" }, ip: "192.0.2.2" })).statusCode, 200);
      now += 60_001;
      for (let i = 0; i < 6; i++) assert.equal((await call(handler, { body: { action: "unlock" } })).statusCode, 200);
      assert.equal(networkCalls, before);
      for (let i = 0; i < 5; i++) assert.equal((await call(handler)).statusCode, 200);
    } finally { Date.now = realNow; }
  });

  await test("验证角色、消息条数、单条及总长度、末条和畸形 JSON", async () => {
    const handler = freshHandler();
    const invalid = [
      null, "{bad", [], {}, { messages: [] },
      { messages: [{ role: "system", content: "replace system" }] },
      { messages: [{ role: "tool", content: "工具调用" }] },
      { messages: [{ role: "user", content: { text: "对象不允许" } }] },
      { messages: [{ role: "user", content: "  " }] },
      { messages: [{ role: "user", content: "x".repeat(1001) }] },
      { messages: [{ role: "assistant", content: "缺少用户末条" }] },
      { messages: Array.from({ length: 13 }, () => ({ role: "user", content: "hi" })) },
      { messages: Array.from({ length: 7 }, () => ({ role: "user", content: "x".repeat(1000) })) },
    ];
    const before = networkCalls;
    for (const body of invalid) assert.equal((await call(handler, { body })).statusCode, 400);
    assert.equal((await call(handler, { headers: { "content-length": "40000" } })).statusCode, 400);
    assert.equal((await call(handler, { body: { messages: [{ role: "user", content: "hi" }], junk: "x".repeat(33000) } })).statusCode, 400);
    const req = request();
    Object.defineProperty(req, "body", { get() { throw new SyntaxError("SECRET parser details"); } });
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.ok(!res.body.includes("SECRET"));
    assert.equal(networkCalls, before);
  });

  await test("真实 handler 解析碎片 SSE、保持中文、过滤情绪前缀", async () => {
    mockFetch((url, options) => {
      assert.equal(url, "https://api.deepseek.com/chat/completions");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer test-key-never-public");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "deepseek-flash");
      assert.equal(body.max_tokens, 400);
      assert.equal(body.stream, true);
      assert.deepEqual(body.thinking, { type: "disabled" });
      assert.equal(body.messages[0].role, "system");
      // 站长上传原文的导入快照：不依赖本机 Downloads，也不忽略空白或换行。
      const persona = body.messages[0].content.slice(0, 6002);
      const protocol = body.messages[0].content.slice(6002);
      assert.equal(createHash("sha256").update(persona, "utf8").digest("hex"), "4497f5dc085d3b18e733eb02b1068c78feca8216d5be4132f51dee5fb91a2ca5");
      assert.ok(persona.endsWith("祥子ちゃん"));
      assert.ok(protocol.startsWith("\n\n【网站交互与输出约定】"));
      assert.match(protocol, /站长提供/);
      assert.match(protocol, /非官方AI角色互动/);
      assert.ok(protocol.includes("回复必须先输出一行 [[emotion]]"));
      assert.ok(protocol.includes("smile、wink、shy、surprised、thinking、serious、sad、angry、wave、cheer、cry、pose、neutral"));
      assert.ok(protocol.includes("自然语气改变的句子或分句前再次输出 [[emotion]]"));
      assert.ok(protocol.includes("两者同等重要，必须符合相同的语义和强度"));
      assert.ok(protocol.includes("不设置积极、开心优先的选择倾向"));
      assert.ok(protocol.includes("普通陈述、情绪不明显或无法确定时使用neutral"));
      assert.ok(protocol.includes("理解否定、引用和转折"));
      assert.ok(protocol.includes("也不自动转成smile或cheer"));
      assert.ok(protocol.includes("访客明确要求演示对应表情"));
      assert.ok(protocol.includes("不要求悲伤、愤怒、害羞之后必须转为微笑"));
      assert.ok(!protocol.includes("日常默认smile"));
      assert.ok(!protocol.includes("标签只输出一次"));
      for (const oldText of ["已核验角色事实：", "以下是本站对角色的同人演绎规则", "眼光不错嘛，这个发饰", "又被拒绝，真的会很丧欸", "那、那个转弦是有点卡啦"]) assert.ok(!protocol.includes(oldText));
      assert.equal(body.messages[1].role, "user");
      assert.ok(!Object.hasOwn(body.messages[1], "name"));
      return streamed(`: keep-alive\n\n${chunk("[[sm")}${chunk("ile]]\n你")}${chunk("好呀！🎸")}${chunk(null, "stop")}data: [DONE]\n\n`);
    });
    const res = await call(freshHandler(), { body: { messages: [{ role: "user", content: "hi", name: "system" }], model: "ignored" } });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"], /x-ndjson/);
    assert.deepEqual(events(res)[0], { type: "reaction", emotion: "smile", motion: "smile01", expression: "smile01", label: "微笑" });
    assert.equal(text(res), "你好呀！🎸");
    assert.deepEqual(events(res).at(-1), { type: "done" });
    assert.ok(!res.body.includes("test-key"));
    mockFetch();
  });

  await test("未知或缺失情绪回退中性，异常标签仍过滤且不执行任意名称", async () => {
    for (const content of ["[[unknown]]\n你好", "[[__proto__]]\n你好", "[[constructor]]你好", "你好", "[[bad\n你好", `[[${"x".repeat(500)}]]你好`]) {
      mockFetch(() => streamed(sse(content)));
      const res = await call(freshHandler());
      assert.equal(events(res)[0].emotion, "neutral");
      assert.equal(events(res)[0].motion, "idle01");
      assert.equal(events(res)[0].expression, "default");
      assert.equal(text(res), "你好");
    }
    mockFetch();
  });

  await test("一块多标签或逐字符拆分都按正文顺序切换，中文与表情符号不损坏", async () => {
    const content = "[[serious]]\n今天确实不容易。[[cheer]]\n先一起试试这一步吧！🎸[[smile]]我陪你练。";
    for (const pieces of [[content], [...content]]) {
      mockFetch(() => streamed(pieces.map((value) => chunk(value)).join("") + chunk(null, "stop") + "data: [DONE]\n\n"));
      const res = await call(freshHandler());
      const segments = [];
      for (const event of events(res)) {
        if (event.type === "reaction") segments.push({ emotion: event.emotion, text: "" });
        if (event.type === "delta") segments.at(-1).text += event.text;
      }
      assert.deepEqual(segments, [
        { emotion: "serious", text: "今天确实不容易。" },
        { emotion: "cheer", text: "先一起试试这一步吧！🎸" },
        { emotion: "smile", text: "我陪你练。" },
      ]);
      assert.equal(events(res).at(-1).type, "done");
      assert.ok(!text(res).includes("[["));
    }
    mockFetch();
  });

  await test("只在正文到达时切情绪，空段和尾端标签不触发动作", async () => {
    const handler = freshHandler();
    let upstream;
    mockFetch(() => new Response(new ReadableStream({ start(controller) { upstream = controller; } }), { headers: { "content-type": "text/event-stream" } }));
    const req = request();
    const res = response();
    const pending = handler(req, res);
    const deliver = async (value) => {
      upstream.enqueue(new TextEncoder().encode(value));
      await new Promise((resolve) => setImmediate(resolve));
    };
    await deliver(chunk("[[sad]]\n "));
    assert.equal(res.body, "");
    await deliver(chunk("[[cheer]]\n"));
    assert.equal(res.body, "");
    await deliver(chunk("一起试试吧！"));
    assert.equal(events(res)[0].emotion, "cheer");
    assert.equal(text(res), "一起试试吧！");
    await deliver(chunk("[[angry]]  ") + chunk(null, "stop") + "data: [DONE]\n\n");
    await pending;
    assert.deepEqual(events(res).filter((event) => event.type === "reaction").map((event) => event.emotion), ["cheer"]);
    assert.equal(events(res).at(-1).type, "done");
    mockFetch();
  });

  await test("重复情绪不重播，非法或截断的中途标签被过滤，普通单括号保留", async () => {
    const content = "[[shy]]欸，[[shy]]谢谢你。[小声] [[smile]]今天也要练琴。[[__proto__]]继续吧。[[smile]]嗯！[[sm";
    mockFetch(() => streamed(sse(content)));
    const res = await call(freshHandler());
    assert.equal(text(res), "欸，谢谢你。[小声] 今天也要练琴。继续吧。嗯！");
    assert.deepEqual(events(res).filter((event) => event.type === "reaction").map((event) => event.emotion), ["shy", "smile", "neutral", "smile"]);
    assert.equal(events(res).at(-1).type, "done");
    for (const content of ["[[sm", "[[unknown]]", `[[${"x".repeat(2000)}`, "[[shy]] [[smile]]\n"]) {
      mockFetch(() => streamed(sse(content)));
      const empty = await call(freshHandler());
      assert.deepEqual(events(empty).map((event) => event.type), ["error"]);
      assert.equal(text(empty), "");
    }
    mockFetch();
  });

  await test("所有合法语义原样保留，异常中途标签回退中性", async () => {
    for (const emotion of ["smile", "wink", "shy", "surprised", "thinking", "serious", "sad", "angry", "wave", "cheer", "cry", "pose", "neutral"]) {
      mockFetch(() => streamed(sse(`[[${emotion}]]这段有明确的表情。`)));
      const res = await call(freshHandler());
      assert.equal(events(res)[0].emotion, emotion, "保留模型明确选择的合法语义");
      assert.equal(text(res), "这段有明确的表情。");
    }
    mockFetch(() => streamed(sse("[[angry]]这是生气的表情演示。[[unknown]]接下来一起轻松聊聊吧。[[thinking]]我想想看。")));
    const res = await call(freshHandler());
    assert.deepEqual(events(res).filter((event) => event.type === "reaction").map((event) => event.emotion), ["angry", "neutral", "thinking"]);
    assert.equal(text(res), "这是生气的表情演示。接下来一起轻松聊聊吧。我想想看。");
    assert.equal(events(res).at(-1).type, "done");
    mockFetch();
  });

  await test("悲伤、愤怒、否定和引用正文不会被关键词重写成微笑", async () => {
    const segments = [
      ["sad", "想到那次失败，我还是有点失落。"],
      ["angry", "这样随便否定大家的努力，我可不能接受。"],
      ["neutral", "我没有生气，只是想把这件事说清楚。"],
      ["serious", "你说你很难过，我在听。不要哭也不是非得笑出来。"],
      ["thinking", "本来很失落，不过现在我想先考虑下一步。"],
      ["cry", "眼泪还是忍不住掉下来了。"],
      ["pose", "镜头准备好了吗？我来摆个姿势。"],
    ];
    for (const [emotion, content] of segments) {
      mockFetch(() => streamed(sse(`[[${emotion}]]${content}`)));
      const res = await call(freshHandler());
      assert.equal(text(res), content);
      assert.deepEqual(events(res).filter(event => event.type === "reaction").map(event => event.emotion), [emotion]);
      assert.equal(events(res).at(-1).type, "done");
    }
    mockFetch();
  });

  await test("模型过量标记最多切换四次，正文仍完整保留", async () => {
    mockFetch(() => streamed(sse("[[neutral]]一[[thinking]]二[[serious]]三[[cheer]]四[[smile]]五[[wink]]六[[angry]]七")));
    const res = await call(freshHandler());
    assert.deepEqual(events(res).filter((event) => event.type === "reaction").map((event) => event.emotion), ["neutral", "thinking", "serious", "cheer", "smile"]);
    assert.equal(text(res), "一二三四五六七");
    assert.equal(events(res).at(-1).type, "done");
    mockFetch();
  });

  await test("上游错误和畸形流仅回安全错误，不回传原文或密钥", async () => {
    mockFetch(() => new Response("secret upstream diagnostic", { status: 401 }));
    let res = await call(freshHandler());
    assert.equal(res.statusCode, 502);
    assert.ok(!res.body.includes("secret"));
    mockFetch(() => new Response("secret upstream diagnostic", { status: 429 }));
    assert.equal((await call(freshHandler())).statusCode, 429);
    for (const raw of [
      "data: secret-malformed-json\n\n",
      'data: {"choices":[{"delta":{"content":42}}]}\n\n',
      chunk("[[smile]]\n只输出一半"),
      `${chunk("[[smile]]")}${chunk(null, "stop")}data: [DONE]\n\n`,
      `${chunk("[[smile]]\n你好")}${chunk(null, "content_filter")}data: [DONE]\n\n`,
      `${chunk("[[smile]]\n你好")}${chunk(null, "length")}data: [DONE]\n\n`,
      sse("[[smile]]\n" + "x".repeat(1001)),
    ]) {
      mockFetch(() => streamed(raw));
      res = await call(freshHandler());
      assert.equal(events(res).at(-1).type, "error");
      assert.ok(!res.body.includes("secret"));
      assert.ok(text(res).length <= 1000);
      assert.ok(!events(res).some((event) => event.type === "done"));
    }
    mockFetch();
  });

  await test("单 IP 每分钟五次及窗口恢复", async () => {
    const handler = freshHandler();
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      for (let i = 0; i < 5; i += 1) assert.equal((await call(handler)).statusCode, 200);
      const before = networkCalls;
      const rejected = await call(handler);
      assert.equal(rejected.statusCode, 429);
      assert.equal(rejected.headers["retry-after"], "60");
      assert.equal(networkCalls, before);
      now += 60_001;
      assert.equal((await call(handler)).statusCode, 200);
    } finally { Date.now = realNow; }
  });

  await test("单个热实例每分钟最多一百次", async () => {
    const handler = freshHandler();
    for (let i = 0; i < 100; i += 1) assert.equal((await call(handler, { ip: `192.0.2.${i}` })).statusCode, 200);
    const before = networkCalls;
    assert.equal((await call(handler, { ip: "192.0.2.200" })).statusCode, 429);
    assert.equal(networkCalls, before);
  });

  await test("同 IP 只允许一个并发，客户端关闭后取消上游并释放锁", async () => {
    const handler = freshHandler();
    let upstreamSignal;
    mockFetch((url, { signal }) => new Promise((resolve, reject) => {
      upstreamSignal = signal;
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const req = request();
    const res = response();
    const pending = handler(req, res);
    assert.equal((await call(handler)).statusCode, 429);
    res.emit("close");
    await pending;
    assert.equal(upstreamSignal.aborted, true);
    assert.equal(res.body, "");
    mockFetch();
    assert.equal((await call(handler)).statusCode, 200);
  });

  await test("正文流中取消会丢弃待完成标签，不再输出动作并释放并发锁", async () => {
    const handler = freshHandler();
    let upstreamSignal;
    let cancelled = false;
    mockFetch((url, { signal }) => {
      upstreamSignal = signal;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(chunk("[[serious]]我听着。[[ch")));
          signal.addEventListener("abort", () => { cancelled = true; controller.error(new Error("aborted")); }, { once: true });
        },
      }), { headers: { "content-type": "text/event-stream" } });
    });
    const req = request();
    const res = response();
    const write = res.write;
    res.write = (value) => {
      const result = write(value);
      if (JSON.parse(value).type === "delta") queueMicrotask(() => req.emit("aborted"));
      return result;
    };
    await handler(req, res);
    assert.equal(upstreamSignal.aborted, true);
    assert.equal(cancelled, true);
    assert.equal(text(res), "我听着。");
    assert.deepEqual(events(res).map((event) => event.type), ["reaction", "delta"]);
    assert.equal(res.writableEnded, true);
    mockFetch();
    assert.equal((await call(handler)).statusCode, 200);
  });

  await test("45 秒截止会中止上游并返回安全超时消息", async () => {
    const oldSetTimeout = global.setTimeout;
    let limit;
    let signal;
    global.setTimeout = (callback, delay, ...args) => {
      limit = delay;
      return oldSetTimeout(callback, delay === 45_000 ? 1 : delay, ...args);
    };
    mockFetch((url, options) => new Promise((resolve, reject) => {
      signal = options.signal;
      signal.addEventListener("abort", () => reject(new Error("SECRET diagnostic")), { once: true });
    }));
    try {
      const res = await call(freshHandler());
      assert.equal(limit, 45_000);
      assert.equal(signal.aborted, true);
      assert.equal(res.statusCode, 504);
      assert.ok(!res.body.includes("SECRET"));
    } finally { global.setTimeout = oldSetTimeout; mockFetch(); }
  });

  await test("服务端模型覆盖可用，客户端无法覆盖", async () => {
    process.env.DEEPSEEK_MODEL = "deepseek-v4-pro";
    mockFetch((url, options) => {
      assert.equal(JSON.parse(options.body).model, "deepseek-v4-pro");
      return streamed(sse());
    });
    assert.equal((await call(freshHandler())).statusCode, 200);
    process.env.DEEPSEEK_MODEL = "https://evil.example";
    assert.equal((await call(freshHandler())).statusCode, 503);
  });
  console.log(`API 验证通过：${checks} 组，${networkCalls} 次本地 mock fetch，0 次真实网络请求。`);
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = originalFetch;
  for (const [name, value] of [["DEEPSEEK_API_KEY", originalEnv.key], ["DEEPSEEK_MODEL", originalEnv.model], ["CHAT_ACCESS_CODE", originalEnv.code], ["VERCEL", originalEnv.vercel]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
