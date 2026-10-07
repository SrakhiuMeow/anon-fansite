"use strict";

// 调用真实播放器；只替换浏览器边界，不联网、不生成语音、不依赖浏览器音频设备。
const assert = require("node:assert/strict");
const { create } = require("../assets/js/anon-voice.js");
const MB = 1024 * 1024;
const ACCESS_CODE = "fixture secret 中文 & ?";
let checks = 0;

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
  }
  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
  dispatch(name) { for (const listener of [...(this.listeners.get(name) || [])]) listener({ type: name, target: this }); }
}
class Element extends Events {
  constructor(tag = "div") {
    super(); this.tagName = tag; this.children = []; this.attributes = {}; this.textContent = "";
    this.disabled = false; this.hidden = false; this.parentNode = null; this.root = false;
  }
  get isConnected() { return this.root || !!this.parentNode?.isConnected; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  append(...children) { for (const child of children) this.appendChild(child); }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null; this.root = false;
  }
  click() { if (!this.disabled) this.dispatch("click"); }
}
const settle = async () => { for (let i = 0; i < 6; ++i) await new Promise((resolve) => setImmediate(resolve)); };
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const mp3 = (size = 128, options = {}) => new Response(new Uint8Array(size), {
  headers: { "content-type": "audio/mpeg", "content-language": "ja", ...options.headers }, status: options.status || 200,
});
const wav = (size = 64, options = {}) => new Response(new Uint8Array(size), {
  headers: { "content-type": "audio/x-wav", "content-language": "ja", ...options.headers }, status: options.status || 200,
});
const bothProviders = [
  { id: "fish", name: "Fish Audio", language: "ja", auto: true, available: true },
  { id: "vits2", name: "Bangstarlight VITS2", language: "ja", auto: false, available: true },
];
function fixture(options = {}) {
  const host = new Events();
  const document = new Events();
  const root = new Element(); root.root = true;
  const toggle = new Element("button"); const status = new Element("span"); const provider = new Element("select");
  root.append(toggle, status, provider);
  document.getElementById = (id) => ({ anonVoiceAuto: toggle, anonVoiceStatus: status, anonVoiceProvider: provider })[id] || null;
  document.createElement = (tag) => new Element(tag);
  document.hidden = false;
  const storage = new Map();
  host.localStorage = {
    getItem: (name) => storage.has(name) ? storage.get(name) : (options.storedProvider ?? null),
    setItem: (name, value) => storage.set(name, String(value)),
  };
  const audioInstances = []; const posts = []; const gets = []; const generated = []; const revoked = [];
  const timers = new Map(); let timerId = 0;
  class Audio extends Events {
    constructor() { super(); this.src = ""; this.plays = []; this.pauses = 0; this.playing = false; audioInstances.push(this); }
    play() {
      this.plays.push(this.src);
      if (this.src.startsWith("blob:")) {
        const failure = options.playError?.(this.src);
        if (failure) return Promise.reject(failure);
      }
      this.playing = true; return Promise.resolve();
    }
    pause() { this.pauses += 1; this.playing = false; }
    removeAttribute(name) { if (name === "src") this.src = ""; }
    load() {}
  }
  host.document = document; host.location = { protocol: options.protocol || "https:" };
  host.Audio = options.noAudio ? class { constructor() { throw new Error("unsupported"); } } : Audio;
  host.AbortController = AbortController; host.Blob = Blob;
  host.URL = {
    createObjectURL(blob) { const entry = { url: `blob:test-${generated.length + 1}`, size: blob.size }; generated.push(entry); return entry.url; },
    revokeObjectURL(url) { revoked.push(url); },
  };
  host.setTimeout = (fn, duration) => { const id = ++timerId; timers.set(id, { fn, duration }); return id; };
  host.clearTimeout = (id) => timers.delete(id);
  host.fetch = async (url, init = {}) => {
    const request = { url, ...init };
    if (init.method === "POST") { posts.push(request); return options.synthesize ? options.synthesize(request, posts.length) : mp3(options.audioSize); }
    gets.push(request);
    return options.capability ? options.capability(request) : new Response(JSON.stringify({
      enabled: options.enabled !== false,
      language: "ja",
      providers: options.providers || [{ id: "fish", name: "Fish Audio", language: "ja", auto: true, available: options.enabled !== false }],
    }), { headers: { "content-type": "application/json" } });
  };
  const player = create({ host, getAccessCode: () => ACCESS_CODE });
  player.sync({ ai: true, unlocked: true, busy: false });
  function add(text = "今天练琴也有进步！", { connected = true } = {}) {
    const element = new Element(); if (connected) root.append(element);
    player.addReply(element, text);
    const row = element.children[0];
    return { element, row, button: row?.children[0], state: row?.children[1] };
  }
  return { host, document, root, toggle, status, provider, storage, posts, gets, generated, revoked, timers, player, add,
    get audio() { return audioInstances[0]; },
    get clipPlays() { return audioInstances.flatMap((audio) => audio.plays.filter((src) => src.startsWith("blob:"))); },
    async ready() { await settle(); },
    async click(record) { record.button.click(); await settle(); },
    expire(duration) { for (const [id, timer] of [...timers]) if (timer.duration === duration) { timers.delete(id); timer.fn(); } },
  };
}
async function test(name, run) { await run(); ++checks; console.log(`通过：${name}`); }

(async () => {
  await test("默认自动朗读关闭，能力检查和添加完整回复不发语音 POST", async () => {
    const f = fixture(); await f.ready(); const reply = f.add(); await settle();
    assert.equal(f.gets.length, 1); assert.equal(f.gets[0].url, "/api/tts"); assert.equal(f.gets[0].cache, "no-store");
    assert.equal(f.toggle.attributes["aria-checked"], "false"); assert.match(f.toggle.textContent, /关/);
    assert.equal(f.posts.length, 0); assert.equal(reply.button.disabled, false); assert.equal(f.clipPlays.length, 0);
    assert.match(reply.button.textContent, /日语/); assert.match(reply.button.attributes["aria-label"], /日语.*保留聊天原文/);
    assert.match(f.status.textContent, /DeepSeek.*日语.*Fish Audio.*聊天原文不变/);
  });
  await test("单条中文正文送服务端转日语，播放和重播均不改写气泡原文", async () => {
    const original = "今天的练习好累，不过我觉得自己进步了！";
    const f = fixture(); await f.ready(); const reply = f.add(original);
    const content = new Element("span"); content.textContent = original; reply.element.appendChild(content);
    await f.click(reply);
    assert.deepEqual(JSON.parse(f.posts[0].body), { text: original, provider: "fish" });
    assert.equal(content.textContent, original); assert.match(reply.state.textContent, /正在播放.*日语/);
    f.audio.dispatch("ended"); await f.click(reply);
    assert.equal(content.textContent, original); assert.equal(f.posts.length, 1);
  });
  await test("语音方案来自服务端白名单，默认 Fish，选择存本机且单块方案禁用自动朗读", async () => {
    const f = fixture({ providers: bothProviders }); await f.ready();
    assert.equal(f.provider.hidden, false);
    assert.equal(f.provider.value, "fish");
    assert.deepEqual(f.provider.children.map((option) => option.value), ["fish", "vits2"]);
    assert.equal(f.toggle.disabled, false);
    f.provider.value = "vits2"; f.provider.dispatch("change"); await settle();
    assert.equal(f.provider.value, "vits2");
    assert.equal(f.storage.get("anon-voice-provider"), "vits2");
    assert.equal(f.toggle.disabled, true);
    assert.match(f.status.textContent, /VITS2.*只朗读开头/);
  });
  await test("单块方案按 provider 请求、接受 wav，截断时说明只朗读开头", async () => {
    const f = fixture({ providers: bothProviders, storedProvider: "vits2", synthesize: () => wav(64, { headers: { "x-voice-truncated": "1" } }) });
    await f.ready();
    assert.equal(f.provider.value, "vits2");
    const reply = f.add(); await f.click(reply);
    assert.deepEqual(JSON.parse(f.posts[0].body), { text: "今天练琴也有进步！", provider: "vits2" });
    assert.match(reply.state.textContent, /正在播放/);
    f.audio.dispatch("ended");
    assert.match(reply.state.textContent, /只朗读开头/);
  });
  await test("切换方案作废旧缓存并按新方案重新请求同一条回复", async () => {
    const seen = [];
    const f = fixture({
      providers: bothProviders,
      synthesize: (request, index) => { seen.push(JSON.parse(request.body).provider); return index === 1 ? mp3() : wav(); },
    });
    await f.ready();
    const reply = f.add(); await f.click(reply); f.audio.dispatch("ended");
    assert.equal(f.posts.length, 1);
    f.provider.value = "vits2"; f.provider.dispatch("change"); await settle();
    await f.click(reply);
    assert.deepEqual(seen, ["fish", "vits2"]);
  });
  await test("手动播放、停止、结束与同页缓存重播", async () => {
    const f = fixture(); await f.ready(); const reply = f.add(); await f.click(reply);
    assert.equal(f.posts.length, 1); assert.equal(f.clipPlays.length, 1); assert.match(reply.state.textContent, /正在播放/);
    assert.equal(reply.button.attributes["aria-pressed"], "true"); await f.click(reply);
    assert.equal(f.audio.playing, false); assert.match(reply.state.textContent, /停止/);
    assert.match(reply.button.textContent, /重播/); await f.click(reply);
    assert.equal(f.posts.length, 1); assert.equal(f.clipPlays.length, 2);
    f.audio.dispatch("ended"); assert.match(reply.state.textContent, /完毕/); assert.equal(reply.button.attributes["aria-pressed"], "false");
  });
  await test("一时仅播一条，切另一回复即停止前一条并复用唯一播放器", async () => {
    const f = fixture(); await f.ready(); const a = f.add("第一条完整回复"); const b = f.add("第二条完整回复");
    await f.click(a); const pauses = f.audio.pauses; await f.click(b);
    assert.equal(f.clipPlays.length, 2); assert.ok(f.audio.pauses > pauses); assert.match(a.state.textContent, /停止/);
    assert.equal(a.button.attributes["aria-pressed"], "false"); assert.equal(b.button.attributes["aria-pressed"], "true");
    assert.equal(f.audio.src, f.generated[1].url);
  });
  await test("取消后的旧请求迟到不缓存、不抢播新的回复", async () => {
    const old = deferred(); const f = fixture({ synthesize: (_, i) => i === 1 ? old.promise : mp3() });
    await f.ready(); const a = f.add("等待中的旧回复"); const b = f.add("下一条新回复");
    await f.click(a); await f.click(b); assert.equal(f.posts[0].signal.aborted, true);
    old.resolve(mp3()); await settle(); assert.equal(f.generated.length, 1); assert.equal(f.clipPlays.length, 1);
    assert.equal(f.audio.src, f.generated[0].url); assert.match(b.state.textContent, /正在播放/);
  });
  for (const [name, cancel] of [
    ["清空", (f) => f.player.clear()], ["锁定", (f) => f.player.sync({ unlocked: false })],
    ["切回本地模式", (f) => f.player.sync({ ai: false })], ["发送新消息", (f) => f.player.sync({ busy: true })],
    ["离开页面", (f) => f.host.dispatch("pagehide")], ["页面隐藏", (f) => { f.document.hidden = true; f.document.dispatch("visibilitychange"); }],
  ]) await test(`${name}取消在途生成，迟到结果不可播放`, async () => {
    const pending = deferred(); const f = fixture({ synthesize: () => pending.promise });
    await f.ready(); const reply = f.add(); await f.click(reply); cancel(f);
    assert.equal(f.posts[0].signal.aborted, true); pending.resolve(mp3()); await settle();
    assert.equal(f.clipPlays.length, 0); assert.equal(f.generated.length, 0); assert.equal(f.audio.playing, false);
  });
  await test("自动朗读只在完整回复入列、生成结束 busy=false 后开始", async () => {
    const f = fixture(); await f.ready(); f.toggle.click(); f.player.sync({ busy: true }); await settle();
    assert.equal(f.posts.length, 0); const reply = f.add("流式生成结束后才加入的完整回复。"); await settle();
    assert.equal(f.posts.length, 0); assert.equal(reply.button.disabled, true);
    f.player.sync({ busy: false }); await settle(); assert.equal(f.posts.length, 1); assert.equal(f.clipPlays.length, 1);
    f.player.sync({ busy: false }); await settle(); assert.equal(f.posts.length, 1);
  });
  for (const [name, disable, restore] of [
    ["锁定", { unlocked: false }, { unlocked: true, busy: false }],
    ["切模式", { ai: false }, { ai: true, busy: false }],
  ]) await test(`${name}丢弃尚未开播的自动队列，恢复后不朗读旧回复`, async () => {
    const f = fixture(); await f.ready(); f.toggle.click(); f.player.sync({ busy: true }); f.add("已取消的旧回复");
    f.player.sync(disable); f.player.sync(restore); await settle(); assert.equal(f.posts.length, 0);
  });
  await test("关闭自动朗读会停止当前播放，后续回复只提供手动按钮", async () => {
    const f = fixture(); await f.ready(); f.toggle.click(); f.add(); await settle(); assert.equal(f.clipPlays.length, 1);
    f.toggle.click(); f.add("另一个完整回复"); await settle(); assert.equal(f.audio.playing, false); assert.equal(f.posts.length, 1);
    assert.equal(f.toggle.attributes["aria-checked"], "false");
  });
  await test("手动语音正在播放时开启自动朗读，不用静音预热截断当前音频", async () => {
    const f = fixture(); await f.ready(); const reply = f.add(); await f.click(reply);
    const source = f.audio.src; const plays = [...f.audio.plays]; const pauses = f.audio.pauses;
    assert.match(source, /^blob:/); f.toggle.click(); await settle();
    assert.equal(f.toggle.attributes["aria-checked"], "true"); assert.equal(f.audio.src, source);
    assert.deepEqual(f.audio.plays, plays); assert.equal(f.audio.pauses, pauses); assert.equal(f.audio.playing, true);
    assert.equal(reply.button.attributes["aria-pressed"], "true"); assert.match(reply.state.textContent, /正在播放/);
    assert.equal(f.posts.length, 1); assert.equal(f.posts[0].signal.aborted, false);
    f.audio.dispatch("ended"); assert.match(reply.state.textContent, /完毕/);
  });
  await test("手动语音正在生成时开启自动朗读，保留原任务且不重复预热或请求", async () => {
    const pending = deferred(); const f = fixture({ synthesize: () => pending.promise });
    await f.ready(); const reply = f.add(); await f.click(reply);
    const source = f.audio.src; const plays = [...f.audio.plays]; const pauses = f.audio.pauses;
    assert.match(reply.state.textContent, /正在翻译并生成日语/); f.toggle.click(); await settle();
    assert.equal(f.toggle.attributes["aria-checked"], "true"); assert.equal(f.audio.src, source);
    assert.deepEqual(f.audio.plays, plays); assert.equal(f.audio.pauses, pauses);
    assert.equal(reply.button.attributes["aria-pressed"], "true"); assert.match(reply.state.textContent, /正在翻译并生成日语/);
    assert.equal(f.posts.length, 1); assert.equal(f.posts[0].signal.aborted, false);
    pending.resolve(mp3()); await settle(); assert.equal(f.posts.length, 1); assert.equal(f.clipPlays.length, 1);
    assert.match(reply.state.textContent, /正在播放/); assert.equal(reply.button.attributes["aria-pressed"], "true");
  });
  await test("切后台后才生成完的回复不自动播放，返回前台不抢播旧回复", async () => {
    const f = fixture(); await f.ready(); f.toggle.click(); f.player.sync({ busy: true });
    f.document.hidden = true; f.document.dispatch("visibilitychange"); const reply = f.add("后台刚刚生成完的回复");
    f.player.sync({ busy: false }); await settle(); assert.equal(f.posts.length, 0);
    f.document.hidden = false; f.document.dispatch("visibilitychange"); f.player.sync({ busy: false }); await settle();
    assert.equal(f.posts.length, 0); await f.click(reply); assert.equal(f.posts.length, 1);
  });
  await test("浏览器阻止自动播放后保留音频，手动重播不重复请求", async () => {
    let denied = true; const error = new Error("gesture needed"); error.name = "NotAllowedError";
    const f = fixture({ playError: () => denied ? error : null }); await f.ready(); f.toggle.click();
    const reply = f.add(); await settle(); assert.match(reply.state.textContent, /点击重播/); assert.match(reply.button.textContent, /重播/);
    assert.equal(f.posts.length, 1); assert.equal(f.revoked.length, 0); denied = false; await f.click(reply);
    assert.equal(f.posts.length, 1); assert.match(reply.state.textContent, /正在播放/);
  });
  await test("网络和服务器错误只显示固定提示，不执行或展示原始服务端错误", async () => {
    const payload = '<img src=x onerror="globalThis.compromised=true">PRIVATE upstream details';
    const f = fixture({ synthesize: (_, i) => i === 1 ? Promise.reject(new Error(payload)) : new Response(payload, { status: 500 }) });
    await f.ready(); const reply = f.add(); await f.click(reply); assert.match(reply.state.textContent, /失败/);
    assert.ok(!reply.state.textContent.includes(payload)); await f.click(reply); assert.match(reply.state.textContent, /失败/);
    assert.ok(!reply.state.textContent.includes("PRIVATE")); assert.equal(globalThis.compromised, undefined);
    assert.equal(reply.button.disabled, false); assert.ok(reply.element.isConnected); assert.equal(f.clipPlays.length, 0);
  });
  for (const [status, pattern] of [[401, /重新解锁/], [429, /较多/], [503, /暂不可用/]]) {
    await test(`HTTP ${status} 显示可恢复提示，仍能操作文本回复`, async () => {
      const f = fixture({ synthesize: () => new Response("private upstream details", { status }) });
      await f.ready(); const reply = f.add(); await f.click(reply); assert.match(reply.state.textContent, pattern);
      assert.equal(reply.button.disabled, false); assert.equal(f.clipPlays.length, 0); assert.ok(reply.element.isConnected);
    });
  }
  for (const [code, pattern] of [["VOICE_AUTH_FAILED", /密钥不可用/], ["VOICE_ACCESS_DENIED", /音色访问受限/], ["VOICE_CREDIT_REQUIRED", /免费调用条件/], ["VOICE_NOT_FOUND", /音色暂不可用/], ["UNKNOWN_PRIVATE", /服务暂不可用/]]) {
    await test(`语音服务错误码 ${code} 仅映射固定说明`, async () => {
      const f = fixture({ synthesize: () => new Response(JSON.stringify({ code, error: "PRIVATE provider details" }), { status: 503, headers: { "content-type": "application/json; charset=utf-8" } }) });
      await f.ready(); const reply = f.add(); await f.click(reply); assert.match(reply.state.textContent, pattern);
      assert.ok(!reply.state.textContent.includes("PRIVATE")); assert.equal(reply.button.disabled, false); assert.equal(f.clipPlays.length, 0);
    });
  }
  for (const [status, code, pattern] of [[502, "VOICE_TRANSLATION_FAILED", /日语翻译失败.*聊天原文已保留/], [503, "VOICE_TRANSLATION_UNAVAILABLE", /日语翻译服务暂不可用.*聊天原文已保留/]]) {
    await test(`${code}保留原文并提示翻译失败，不回退原文朗读`, async () => {
      const f = fixture({ synthesize: () => new Response(JSON.stringify({ code, error: "PRIVATE translation details" }), { status, headers: { "content-type": "application/json; charset=utf-8" } }) });
      await f.ready(); const reply = f.add("原文还是中文");
      const content = new Element("span"); content.textContent = "原文还是中文"; reply.element.appendChild(content);
      await f.click(reply); assert.match(reply.state.textContent, pattern);
      assert.equal(content.textContent, "原文还是中文"); assert.ok(!reply.state.textContent.includes("PRIVATE"));
      assert.equal(f.posts.length, 1); assert.equal(f.clipPlays.length, 0); assert.equal(f.generated.length, 0); assert.equal(reply.button.disabled, false);
    });
  }
  for (const [name, response, pattern] of [
    ["非 MP3 MIME", () => mp3(128, { headers: { "content-type": "text/html" } }), /格式异常/],
    ["未确认日语", () => mp3(128, { headers: { "content-language": "" } }), /语言未确认/],
    ["非日语音频", () => mp3(128, { headers: { "content-language": "zh" } }), /语言未确认/],
    ["空音频", () => mp3(0), /没有收到/],
    ["Content-Length 超限", () => mp3(128, { headers: { "content-length": String(4 * MB + 1) } }), /过大/],
    ["无长度流式音频超限", () => mp3(4 * MB + 1), /过大/],
  ]) await test(`${name}被拒绝且不生成对象 URL`, async () => {
    const f = fixture({ synthesize: response }); await f.ready(); const reply = f.add(); await f.click(reply);
    assert.match(reply.state.textContent, pattern); assert.equal(f.generated.length, 0); assert.equal(f.clipPlays.length, 0);
  });
  await test("口令仅放入请求头，正文与 URL 不包含口令", async () => {
    const f = fixture(); await f.ready(); const reply = f.add("本条回复正文"); await f.click(reply);
    assert.equal(f.posts[0].headers["X-Chat-Access-Code"], encodeURIComponent(ACCESS_CODE));
    assert.deepEqual(JSON.parse(f.posts[0].body), { text: "本条回复正文", provider: "fish" }); assert.equal(f.posts[0].url, "/api/tts");
    assert.ok(!f.posts[0].body.includes(ACCESS_CODE)); assert.ok(!f.posts[0].url.includes(ACCESS_CODE));
  });
  await test("缓存最多五条，淘汰和清空均撤销对象 URL", async () => {
    const f = fixture(); await f.ready(); const replies = [];
    for (let i = 0; i < 6; ++i) { const reply = f.add(`缓存回复 ${i}`); replies.push(reply); await f.click(reply); f.audio.dispatch("ended"); }
    assert.equal(f.generated.length, 6); assert.deepEqual(f.revoked, [f.generated[0].url]);
    assert.match(replies[0].button.textContent, /^播放/); assert.match(replies[1].button.textContent, /^重播/);
    await f.click(replies[0]); assert.equal(f.posts.length, 7); f.player.clear();
    assert.equal(new Set(f.revoked).size, f.generated.length); assert.equal(f.revoked.length, f.generated.length);
    for (const reply of replies) assert.equal(reply.element.children.length, 0);
  });
  await test("缓存累计最多 12MB，即使不足五条仍淘汰最旧音频", async () => {
    const f = fixture({ audioSize: 4 * MB }); await f.ready();
    for (let i = 0; i < 4; ++i) { await f.click(f.add(`大文件回复 ${i}`)); f.audio.dispatch("ended"); }
    assert.equal(f.generated.length, 4); assert.deepEqual(f.revoked, [f.generated[0].url]);
    assert.equal(f.generated.filter((entry) => !f.revoked.includes(entry.url)).reduce((sum, entry) => sum + entry.size, 0), 12 * MB);
  });
  await test("重复正文复用同一音频，离开 DOM 后只清除无引用的缓存", async () => {
    const f = fixture(); await f.ready(); const a = f.add("相同正文"); const b = f.add("相同正文");
    await f.click(a); f.audio.dispatch("ended"); await f.click(b); f.audio.dispatch("ended"); assert.equal(f.posts.length, 1);
    a.element.remove(); f.add("触发第一次清理"); assert.equal(f.revoked.length, 0);
    b.element.remove(); f.add("触发第二次清理"); assert.deepEqual(f.revoked, [f.generated[0].url]);
  });
  await test("离开 DOM 的正在播放回复被 prune 停止", async () => {
    const f = fixture(); await f.ready(); const reply = f.add(); await f.click(reply); reply.element.remove(); f.add("新的回复");
    assert.equal(f.audio.playing, false); assert.equal(f.revoked.length, 1);
  });
  await test("媒体解码错误删除坏缓存，下次播放可重新合成", async () => {
    const f = fixture(); await f.ready(); const reply = f.add(); await f.click(reply); f.audio.dispatch("error");
    assert.match(reply.state.textContent, /播放失败/); assert.equal(f.revoked.length, 1);
    await f.click(reply); assert.equal(f.posts.length, 2); assert.match(reply.state.textContent, /正在播放/);
  });
  await test("生成超时取消请求并显示可重试提示，不残留计时器", async () => {
    const f = fixture({ synthesize: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    }) });
    await f.ready(); const reply = f.add(); await f.click(reply); f.expire(70000); await settle();
    assert.equal(f.posts[0].signal.aborted, true); assert.match(reply.state.textContent, /超时/);
    assert.equal(f.timers.size, 0); assert.equal(reply.button.disabled, false); assert.equal(f.generated.length, 0);
  });
  await test("没有音频能力和没有 DOM 时安全降级", async () => {
    assert.equal(create({ host: {} }), null); const f = fixture({ noAudio: true }); await f.ready(); const reply = f.add();
    assert.match(f.status.textContent, /不支持/); assert.equal(f.toggle.disabled, true); assert.equal(reply.button.disabled, true);
    assert.equal(f.gets.length, 0); reply.button.click(); assert.equal(f.posts.length, 0);
  });
  await test("服务未配置时禁用语音，文字回复保留", async () => {
    const f = fixture({ enabled: false }); await f.ready(); const reply = f.add();
    assert.match(f.status.textContent, /待配置/); assert.equal(f.toggle.disabled, true); assert.equal(reply.button.disabled, true);
    reply.button.click(); assert.equal(f.posts.length, 0); assert.ok(reply.element.isConnected);
  });
  await test("旧版未声明日语能力时不启用，避免部署切换中播放中文", async () => {
    for (const language of [undefined, "zh"]) {
      const f = fixture({ capability: () => new Response(JSON.stringify({ enabled: true, language }), { headers: { "content-type": "application/json" } }) });
      await f.ready(); const reply = f.add("保留中文文字"); reply.button.click();
      assert.equal(reply.button.disabled, true); assert.equal(f.posts.length, 0); assert.ok(reply.element.isConnected);
    }
  });
  await test("能力检查失败和本地文件环境均安全降级", async () => {
    const a = fixture({ capability: () => Promise.reject(new Error("network")) }); await a.ready();
    assert.match(a.status.textContent, /待配置/); assert.equal(a.toggle.disabled, true);
    const b = fixture({ protocol: "file:" }); await b.ready(); assert.equal(b.gets.length, 0); assert.equal(b.toggle.disabled, true);
  });
  await test("重复添加、空文本、超长文本不产生重复按钮", async () => {
    const f = fixture(); await f.ready(); const reply = f.add(); f.player.addReply(reply.element, "重复添加");
    assert.equal(reply.element.children.length, 1); assert.equal(f.add(" ").row, undefined); assert.equal(f.add("长".repeat(1001)).row, undefined);
  });
  await test("pagehide 撤销全部缓存并关闭自动朗读", async () => {
    const f = fixture(); await f.ready(); f.toggle.click(); const reply = f.add(); await settle(); f.host.dispatch("pagehide");
    assert.equal(f.audio.playing, false); assert.deepEqual(f.revoked, f.generated.map((entry) => entry.url));
    assert.equal(reply.element.children.length, 0); assert.equal(f.toggle.attributes["aria-checked"], "false");
  });
  console.log(`播放器验证完成：${checks} 项通过；无真实网络或语音合成请求。`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
