"use strict";

// 调用实际 handler，只 mock fetch；不访问语音服务、不产生费用。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { EventEmitter } = require("node:events");
const handlerPath = require.resolve("../api/tts.js");
const accessPath = require.resolve("../lib/chat-access.cjs");
const chatPath = require.resolve("../api/chat.js");
const originalFetch = global.fetch;
const envNames = ["FISH_AUDIO_API_KEY", "FISH_AUDIO_VOICE_ID", "CHAT_ACCESS_CODE", "DEEPSEEK_API_KEY", "VERCEL"];
const originalEnv = new Map(envNames.map((name) => [name, process.env[name]]));
const CODE = "tts-test-access";
const VOICE_ID = "c5c17c9709384ba9a4b294662a2af0b1";
const AUDIO = Buffer.concat([Buffer.from([255, 251, 144, 196]), Buffer.alloc(256)]);
let networkCalls = 0;
let checks = 0;

function freshHandler() {
  delete require.cache[handlerPath];
  delete require.cache[chatPath];
  delete require.cache[accessPath];
  return require(handlerPath);
}
function request(options = {}) {
  const req = new EventEmitter();
  req.method = options.method || "POST";
  req.headers = { host: "anon.example", origin: "https://anon.example", "x-forwarded-proto": "https", "content-type": "application/json", "x-chat-access-code": CODE, ...options.headers };
  req.body = options.body === undefined ? { text: "今天终于把那一小段弹顺了！" } : options.body;
  req.socket = { remoteAddress: options.ip || "192.0.2.1" };
  return req;
}
function response() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.body = Buffer.alloc(0);
  res.writableEnded = false;
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  res.end = (body = "") => { res.body = Buffer.concat([res.body, Buffer.from(body)]); res.writableEnded = true; };
  return res;
}
async function call(handler, options) {
  const req = request(options), res = response();
  await handler(req, res);
  return res;
}
function audioResponse(audio = AUDIO, headers = {}) { return new Response(audio, { headers: { "content-type": "audio/mpeg", ...headers } }); }
function mockFetch(factory = () => audioResponse()) {
  global.fetch = async (...args) => { networkCalls += 1; return factory(...args); };
}
async function test(name, run) { await run(); checks += 1; console.log(`通过：${name}`); }

(async () => {
  process.env.FISH_AUDIO_API_KEY = "tts-key-never-public";
  process.env.CHAT_ACCESS_CODE = CODE;
  delete process.env.FISH_AUDIO_VOICE_ID;
  delete process.env.VERCEL;
  mockFetch();

  await test("静态鉴权模块不含盐与摘要，语音复用服务端唯一验证器", async () => {
    const serverSource = fs.readFileSync(chatPath, "utf8");
    const publicSource = fs.readFileSync(accessPath, "utf8");
    const salt = /const ACCESS_SALT = "([^"]+)"/.exec(serverSource)?.[1];
    const hash = /const ACCESS_HASH = Buffer\.from\("([^"]+)"/.exec(serverSource)?.[1];
    assert.ok(salt && hash);
    assert.ok(!publicSource.includes(salt) && !publicSource.includes(hash));
    assert.deepEqual(Object.keys(require(accessPath)).sort(), ["clientKey", "createAccessVerifier"]);
    freshHandler();
    assert.equal(typeof require(chatPath), "function");
    assert.equal(typeof require(chatPath).verifyAccess, "function");
    assert.match(fs.readFileSync(handlerPath, "utf8"), /const \{ verifyAccess \} = require\("\.\/chat\.js"\)/);
  });

  await test("GET 公布启用状态、AI 合成名称和固定音色 ID，不泄漏密钥或聊天口令", async () => {
    const before = networkCalls;
    const res = await call(freshHandler(), { method: "GET" });
    assert.deepEqual(JSON.parse(res.body), { enabled: true, voiceName: "千早爱音 · AI合成", voiceId: VOICE_ID });
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(networkCalls, before);
    for (const secret of [process.env.FISH_AUDIO_API_KEY, CODE]) assert.ok(!res.body.toString().includes(secret));
  });

  await test("未配置密钥时禁用并保留固定音色状态，错误密码仍不能绕过解锁", async () => {
    const key = process.env.FISH_AUDIO_API_KEY;
    delete process.env.FISH_AUDIO_API_KEY;
    const handler = freshHandler();
    assert.deepEqual(JSON.parse((await call(handler, { method: "GET" })).body), { enabled: false, voiceName: "千早爱音 · AI合成", voiceId: VOICE_ID });
    assert.equal((await call(handler)).statusCode, 503);
    assert.equal((await call(handler, { headers: { "x-chat-access-code": "wrong" } })).statusCode, 401);
    process.env.FISH_AUDIO_API_KEY = key;
  });

  await test("旧音色环境变量不能更改指定音色或禁用服务，包括其他有效 ID 与非法 URL", async () => {
    mockFetch((url, options) => {
      assert.equal(url, "https://api.fish.audio/v1/tts");
      assert.equal(JSON.parse(options.body).reference_id, VOICE_ID);
      return audioResponse();
    });
    for (const oldVoice of ["1234567890abcdef1234567890abcdef", "https://evil.example", " "]) {
      process.env.FISH_AUDIO_VOICE_ID = oldVoice;
      const handler = freshHandler();
      const before = networkCalls;
      assert.deepEqual(JSON.parse((await call(handler, { method: "GET" })).body), { enabled: true, voiceName: "千早爱音 · AI合成", voiceId: VOICE_ID });
      assert.equal((await call(handler)).statusCode, 200);
      assert.equal(networkCalls, before + 1);
    }
    delete process.env.FISH_AUDIO_VOICE_ID;
    mockFetch();
  });

  await test("拒绝跨站、缺失 Origin、错误类型与请求方法", async () => {
    const before = networkCalls;
    const handler = freshHandler();
    for (const origin of ["https://evil.example", "https://anon.example.evil", "http://anon.example", "", "null"]) assert.equal((await call(handler, { headers: { origin } })).statusCode, 403);
    assert.equal((await call(handler, { headers: { "content-type": "text/plain" } })).statusCode, 415);
    assert.equal((await call(handler, { method: "DELETE" })).statusCode, 405);
    assert.equal(networkCalls, before);
  });

  await test("拒绝非法、超长、超大输入和客户端模型/地址/音色覆盖", async () => {
    const handler = freshHandler();
    const before = networkCalls;
    for (const body of [null, [], "broken-json", { text: "" }, { text: 1 }, { text: "[[smile]]" }, { text: "爱".repeat(1001) }, { text: "你好", model: "s2.1-pro" }, { text: "你好", reference_id: "bad" }, { text: "你好", voiceId: "1234567890abcdef1234567890abcdef" }, { text: "你好", url: "https://evil.example" }, Buffer.alloc(12_001)]) assert.equal((await call(handler, { body })).statusCode, 400);
    assert.equal((await call(handler, { headers: { "content-length": "12001" } })).statusCode, 400);
    assert.equal(networkCalls, before);
  });

  await test("固定免费模型、官方地址和用户指定音色，只将正文发送给服务端", async () => {
    mockFetch((url, options) => {
      assert.equal(url, "https://api.fish.audio/v1/tts");
      assert.deepEqual(options.headers, { "Content-Type": "application/json", Authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY}`, model: "s2.1-pro-free" });
      assert.equal(options.redirect, "error");
      assert.deepEqual(JSON.parse(options.body), { text: "今天练琴很顺利。[[普通内容]]", reference_id: VOICE_ID, format: "mp3", mp3_bitrate: 128, normalize: true });
      assert.ok(!JSON.stringify(options).includes(CODE));
      return audioResponse();
    });
    const res = await call(freshHandler(), { body: { text: "[[smile]]今天练琴很顺利。[[普通内容]]" } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, AUDIO);
    assert.equal(res.headers["content-type"], "audio/mpeg");
    assert.equal(res.headers["content-length"], String(AUDIO.length));
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    delete process.env.FISH_AUDIO_VOICE_ID;
    mockFetch();
  });

  await test("接受有效 MP3 与 ID3，拒绝空内容、错误网页及伪装音频", async () => {
    const id3 = Buffer.concat([Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]), AUDIO]);
    mockFetch(() => audioResponse(id3, { "content-type": "application/octet-stream" }));
    assert.equal((await call(freshHandler())).statusCode, 200);
    for (const [audio, mime] of [["", "audio/mpeg"], ["SECRET error", "audio/mpeg"], [AUDIO, "application/json"], ["<html>SECRET</html>", "text/html"], [Buffer.from("ID3"), "audio/mpeg"], [Buffer.from([255, 255, 255, 255]), "audio/mpeg"]]) {
      mockFetch(() => audioResponse(audio, { "content-type": mime }));
      const res = await call(freshHandler());
      assert.equal(res.statusCode, 503);
      assert.equal(JSON.parse(res.body).code, "VOICE_INVALID_AUDIO");
      assert.ok(!res.body.toString().includes("SECRET"));
      assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
    }
    mockFetch();
  });

  await test("音频在返回前完整校验；声明及实际字节数均限制 4 MB", async () => {
    mockFetch(() => audioResponse(AUDIO, { "content-length": String(4 * 1024 * 1024 + 1) }));
    assert.equal((await call(freshHandler())).statusCode, 503);
    let cancelled = false;
    mockFetch(() => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); },
      cancel() { cancelled = true; },
    }), { headers: { "content-type": "audio/mpeg" } }));
    const res = await call(freshHandler());
    assert.equal(res.statusCode, 503);
    assert.equal(JSON.parse(res.body).code, "VOICE_INVALID_AUDIO");
    assert.equal(cancelled, true);
    assert.ok(res.body.length < 500);
    mockFetch();
  });

  await test("供应商失败返回安全消息，429 可重试，不自动切换付费模型", async () => {
    const codes = { 401: "VOICE_AUTH_FAILED", 403: "VOICE_ACCESS_DENIED", 402: "VOICE_CREDIT_REQUIRED", 404: "VOICE_NOT_FOUND", 429: "VOICE_RATE_LIMITED", 500: "VOICE_UNAVAILABLE", 503: "VOICE_UNAVAILABLE" };
    for (const [statusText, code] of Object.entries(codes)) {
      const status = Number(statusText);
      const before = networkCalls;
      mockFetch(() => new Response("SECRET upstream details", { status }));
      const res = await call(freshHandler());
      assert.equal(res.statusCode, status === 429 ? 429 : 503);
      assert.equal(JSON.parse(res.body).code, code);
      if (status === 403) assert.equal(JSON.parse(res.body).error, "语音服务拒绝访问当前模型或音色，请站长检查权限。");
      assert.deepEqual(Object.keys(JSON.parse(res.body)).sort(), ["code", "error"]);
      if (status === 429) assert.equal(res.headers["retry-after"], "60");
      assert.ok(!res.body.toString().includes("SECRET"));
      assert.equal(networkCalls, before + 1);
    }
    mockFetch();
  });

  await test("网络异常使用固定诊断码及 503，不泄露请求信息", async () => {
    mockFetch(() => { throw new Error(`SECRET ${process.env.FISH_AUDIO_API_KEY} ${CODE}`); });
    const res = await call(freshHandler());
    assert.equal(res.statusCode, 503);
    assert.deepEqual(JSON.parse(res.body), { code: "VOICE_NETWORK_ERROR", error: "暂时无法连接语音服务，请稍后重试；文字聊天仍可使用。" });
    assert.equal(res.headers["cache-control"], "no-store");
    mockFetch();
  });

  await test("每 IP 每分钟 5 次、单实例每分钟 60 次，并正确恢复窗口", async () => {
    const originalNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      const handler = freshHandler();
      for (let i = 0; i < 5; i += 1) assert.equal((await call(handler)).statusCode, 200);
      assert.equal((await call(handler)).statusCode, 429);
      for (let i = 0; i < 55; i += 1) assert.equal((await call(handler, { ip: `198.51.100.${i}` })).statusCode, 200);
      const before = networkCalls;
      assert.equal((await call(handler, { ip: "198.51.100.222" })).statusCode, 429);
      assert.equal(networkCalls, before);
      now += 60_001;
      assert.equal((await call(handler)).statusCode, 200);
    } finally { Date.now = originalNow; }
  });

  await test("单 IP 同时仅一次；取消请求会中止上游且不会返回音频", async () => {
    const handler = freshHandler();
    let upstreamSignal;
    mockFetch((url, options) => new Promise((resolve, reject) => {
      upstreamSignal = options.signal;
      upstreamSignal.addEventListener("abort", () => reject(new Error("SECRET cancelled")), { once: true });
    }));
    const req = request(), res = response();
    const pending = handler(req, res);
    assert.equal((await call(handler)).statusCode, 429);
    req.emit("aborted");
    await pending;
    assert.equal(upstreamSignal.aborted, true);
    assert.equal(res.body.length, 0);
    assert.equal(req.listenerCount("aborted"), 0);
    assert.equal(res.listenerCount("close"), 0);
    mockFetch();
    assert.equal((await call(handler)).statusCode, 200);
  });

  await test("浏览器关闭连接取消读取，已生成的部分音频也不会写回", async () => {
    let cancelled = false;
    let upstreamSignal;
    mockFetch((url, options) => {
      upstreamSignal = options.signal;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(AUDIO); },
        cancel() { cancelled = true; },
      }), { headers: { "content-type": "audio/mpeg" } });
    });
    const req = request(), res = response();
    const pending = freshHandler()(req, res);
    await new Promise((resolve) => setImmediate(resolve));
    res.emit("close");
    await pending;
    assert.equal(upstreamSignal.aborted, true);
    assert.equal(cancelled, true);
    assert.equal(res.body.length, 0);
    mockFetch();
  });

  await test("60 秒超时覆盖请求和音频读取；取消后释放并发槽", async () => {
    const originalSetTimeout = global.setTimeout;
    let delaySeen;
    global.setTimeout = (fn, delay, ...args) => { delaySeen = delay; return originalSetTimeout(fn, delay === 60_000 ? 1 : delay, ...args); };
    try {
      for (const stalledReader of [false, true]) {
        let signal;
        mockFetch((url, options) => {
          signal = options.signal;
          return stalledReader
            ? new Response(new ReadableStream({ start(controller) { controller.enqueue(AUDIO); } }), { headers: { "content-type": "audio/mpeg" } })
            : new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("SECRET timeout")), { once: true }));
        });
        const handler = freshHandler();
        const res = await call(handler);
        assert.equal(delaySeen, 60_000);
        assert.equal(signal.aborted, true);
        assert.equal(res.statusCode, 504);
        assert.equal(JSON.parse(res.body).code, "VOICE_TIMEOUT");
        assert.ok(!res.body.toString().includes("SECRET"));
        mockFetch();
        assert.equal((await call(handler)).statusCode, 200);
      }
    } finally { global.setTimeout = originalSetTimeout; mockFetch(); }
  });

  await test("聊天与语音共用密码验证和失败限流；不影响既有解锁协议", async () => {
    const handler = freshHandler();
    const chat = require(chatPath);
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
    const before = networkCalls;
    assert.deepEqual(JSON.parse((await call(chat, { body: { action: "unlock" } })).body), { unlocked: true });
    assert.equal((await call(handler, { headers: { "x-chat-access-code": "%invalid" } })).statusCode, 401);
    for (let i = 0; i < 4; i += 1) assert.equal((await call(chat, { body: { action: "unlock" }, headers: { "x-chat-access-code": "wrong" } })).statusCode, 401);
    assert.equal((await call(handler)).statusCode, 429);
    assert.equal((await call(chat, { body: { action: "unlock" } })).statusCode, 429);
    assert.equal(networkCalls, before);
  });

  console.log(`语音 API 验证通过：${checks} 组，${networkCalls} 次 mock fetch，0 次真实网络请求。`);
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = originalFetch;
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
