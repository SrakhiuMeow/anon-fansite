/* 无依赖：node scripts/test-chat-client.cjs。测试真实流解析器与浏览器对话数据流。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { readEvents } = require("../assets/js/anon-dialogue.js");
const encoder = new TextEncoder();
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function settle(test, message) {
  for (let count = 0; count < 30; count++) {
    if (test()) return;
    await tick();
  }
  assert.ok(test(), message);
}

function bytesStream(parts) {
  return new ReadableStream({ start(controller) {
    parts.forEach((part) => controller.enqueue(part));
    controller.close();
  } });
}

async function testParser() {
  const expected = [
    { type: "reaction", motion: "wink01", expression: "smile01" },
    { type: "delta", text: "你好呀，爱音🎸！" },
    { type: "delta", text: "第二行\n一起练习吧。" },
    { type: "done" },
  ];
  const bytes = encoder.encode(`\r\n${expected.map(JSON.stringify).join("\r\n")}\r\n`);
  // 每字节切分必然覆盖中文、emoji 的 UTF-8 跨块与 CR/LF 跨块。
  const actual = [];
  const split = bytesStream(Array.from(bytes, (_, index) => bytes.slice(index, index + 1)));
  await readEvents(split, (event) => actual.push(event));
  assert.deepEqual(actual, expected);
  assert.equal(split.locked, false);

  // 单块包含多事件，最后一条没有换行，结束时必须消费残尾。
  const tail = [];
  await readEvents(bytesStream([encoder.encode(expected.map(JSON.stringify).join("\n"))]), (event) => tail.push(event));
  assert.deepEqual(tail, expected);

  const malformed = bytesStream([encoder.encode('{"type":"delta","text":"前段"}\n{"type":')]);
  const beforeError = [];
  await assert.rejects(readEvents(malformed, (event) => beforeError.push(event)), SyntaxError);
  assert.equal(beforeError.length, 1);
  assert.equal(malformed.locked, false);

  let cancelled = false;
  const serverError = new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode('{"type":"error","message":"服务暂不可用"}\n')); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readEvents(serverError, (event) => {
    if (event.type === "error") throw new Error(event.message);
  }), /服务暂不可用/);
  assert.equal(cancelled, true);
  assert.equal(serverError.locked, false);

  await assert.rejects(readEvents(bytesStream([encoder.encode("x".repeat(65537))]), () => {}), /超出限制/);
}

// 精简 DOM 只替代平台，不改动或复制对话业务逻辑。
class Element {
  constructor() {
    this.children = []; this.listeners = new Map(); this.attributes = {};
    this.textContent = ""; this.value = ""; this.hidden = false; this.disabled = false;
  }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  dispatch(type) { this.listeners.get(type)?.({ preventDefault() {} }); }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  replaceChildren() { this.children = []; }
  get firstElementChild() { return this.children[0]; }
  remove() { this.parent.children = this.parent.children.filter((child) => child !== this); }
  focus() { this.focused = true; }
  blur() {}
  scrollIntoView() {}
}

async function browserFixture({ accessCodeRequired = false, mobile = false, modelReact, modelReady = true } = {}) {
  const ids = Object.fromEntries([
    "anonChatForm", "anonChatInput", "anonChatLog", "anonChatState", "anonChatMode",
    "chatDisclosure", "anonChatStop", "anonChatClear", "anonChatAccessCode", "anonChatAccessField", "anonChatEmotion",
  ].map((id) => [id, new Element()]));
  const send = new Element();
  const aiOption = new Element(); aiOption.disabled = true;
  ids.anonChatMode.value = "local";
  ids.anonChatMode.querySelector = () => aiOption;
  ids.anonChatForm.querySelector = () => send;
  const requests = [];
  const reactions = [];
  const frames = [];
  let nextHttpError = null;
  const root = {
    document: {
      getElementById: (id) => ids[id],
      createElement: () => new Element(),
      querySelectorAll: () => [],
      querySelector: () => null,
    },
    location: { protocol: "https:" },
    matchMedia: () => ({ matches: mobile }),
    requestAnimationFrame: (callback) => { frames.push(callback); },
    AnonLive2D: {
      react: (reaction) => { reactions.push(reaction); return modelReact ? modelReact(reaction) : Promise.resolve({ ok: true }); },
      getState: () => ({ ready: modelReady }),
    },
    fetch: async (url, options = {}) => {
      assert.equal(url, "/api/chat");
      if (options.method !== "POST") return { ok: true, json: async () => ({ enabled: true, accessCodeRequired }) };
      // 使用真实 Headers，覆盖浏览器要求请求头值可转换为 ByteString 的边界。
      new Headers(options.headers);
      const request = { options, messages: JSON.parse(options.body).messages };
      requests.push(request);
      if (nextHttpError) {
        const error = nextHttpError; nextHttpError = null;
        return { ok: false, json: async () => ({ error }) };
      }
      request.body = new ReadableStream({
        start(controller) {
          request.write = (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          request.close = () => controller.close();
          options.signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
        },
      });
      return { ok: true, headers: new Headers({ "content-type": "application/x-ndjson; charset=utf-8" }), body: request.body };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assets/js/anon-dialogue.js"), "utf8"), {
    window: root, AbortController, AbortSignal, TextDecoder, setTimeout, clearTimeout,
  }, { filename: "anon-dialogue.js" });
  await settle(() => !aiOption.disabled, "AI 配置应启用选项");
  return {
    ids, requests, reactions, send,
    frame() { frames.splice(0).forEach((callback) => callback()); },
    submit(text) { ids.anonChatInput.value = text; ids.anonChatForm.dispatch("submit"); },
    select(value) { ids.anonChatMode.value = value; ids.anonChatMode.dispatch("change"); },
    failNext(message) { nextHttpError = message; },
    lastText() { return ids.anonChatLog.children.at(-1)?.children[1]?.textContent; },
    async complete(text) {
      const request = requests.at(-1);
      request.write({ type: "reaction", motion: "smile01", expression: "smile01", label: "微笑" });
      request.write({ type: "delta", text }); request.write({ type: "done" }); request.close();
      await settle(() => !send.disabled, "完成后应恢复发送");
    },
  };
}

async function testClient() {
  const ui = await browserFixture();
  assert.match(ui.ids.chatDisclosure.textContent, /DeepSeek/);
  ui.submit("你好");
  assert.deepEqual(ui.requests[0].messages, [{ role: "user", content: "你好" }]);
  await ui.complete("你好呀！");
  assert.equal(ui.lastText(), "你好呀！");
  assert.ok(ui.reactions.some((value) => value.motion === "smile01"));

  ui.submit("第二句");
  assert.deepEqual(ui.requests[1].messages, [
    { role: "user", content: "你好" }, { role: "assistant", content: "你好呀！" },
    { role: "user", content: "第二句" },
  ]);
  ui.requests[1].write({ type: "delta", text: "只收到半句" });
  await settle(() => ui.lastText() === "只收到半句", "应显示流式正文");
  ui.ids.anonChatStop.dispatch("click");
  await settle(() => !ui.send.disabled, "停止应释放发送按钮");
  assert.equal(ui.requests[1].options.signal.aborted, true);
  assert.match(ui.ids.anonChatState.textContent, /不会加入/);
  ui.submit("停止后继续");
  assert.deepEqual(ui.requests[2].messages.map((item) => item.content), ["你好", "你好呀！", "停止后继续"]);

  // 清空后立即发新请求：旧请求 catch/finally 不能清除新一轮 busy 或文字。
  ui.ids.anonChatClear.dispatch("click");
  assert.equal(ui.requests[2].options.signal.aborted, true);
  ui.submit("清空后新话题");
  assert.deepEqual(ui.requests[3].messages, [{ role: "user", content: "清空后新话题" }]);
  await tick();
  assert.equal(ui.send.disabled, true);
  assert.equal(ui.ids.anonChatLog.children.length, 2);
  await ui.complete("新的开始");

  ui.submit("模式切换前");
  const changing = ui.requests.at(-1);
  ui.select("local");
  ui.submit("眨眼");
  await tick();
  assert.equal(changing.options.signal.aborted, true);
  assert.match(ui.lastText(), /Wink/);
  const localRequestCount = ui.requests.length;
  ui.select("deepseek"); ui.submit("重新连接");
  assert.equal(ui.requests.length, localRequestCount + 1);
  assert.deepEqual(ui.requests.at(-1).messages, [{ role: "user", content: "重新连接" }]);
  await ui.complete("重新见面啦");

  // 服务错误本地降级，并且未完成的用户/降级文本不得进入 AI 历史。
  ui.failNext("服务暂不可用"); ui.submit("眨眼");
  await settle(() => !ui.send.disabled, "HTTP 错误应退出忙碌");
  assert.match(ui.lastText(), /Wink/);
  assert.match(ui.ids.anonChatState.textContent, /本地预设/);
  ui.submit("继续聊");
  assert.deepEqual(ui.requests.at(-1).messages.map((item) => item.content), ["重新连接", "重新见面啦", "继续聊"]);
  // 200 响应中的 error 事件也走降级；用于覆盖真实解析器至 UI 的异常传递。
  ui.requests.at(-1).write({ type: "error", message: "上游请求失败" });
  await settle(() => !ui.send.disabled, "流错误应退出忙碌");
  assert.match(ui.ids.anonChatState.textContent, /上游请求失败.*本地预设/);

  ui.ids.anonChatClear.dispatch("click");
  for (let turn = 1; turn <= 7; turn++) {
    ui.submit(`问题${turn}`); await ui.complete(`回答${turn}`);
  }
  ui.submit("第八问");
  assert.deepEqual(ui.requests.at(-1).messages.map((item) => item.content), [
    "问题3", "回答3", "问题4", "回答4", "问题5", "回答5", "问题6", "回答6", "问题7", "回答7", "第八问",
  ]);
  await ui.complete("第八答");

  // 合法长回复积累后，按服务端总预算剔除最早完整轮次，不能留下孤立 assistant。
  ui.ids.anonChatClear.dispatch("click");
  for (let turn = 1; turn <= 6; turn++) {
    ui.submit(`${"问".repeat(199)}${turn}`);
    await ui.complete(`${"答".repeat(999)}${turn}`);
  }
  ui.submit("新".repeat(200));
  const budgeted = ui.requests.at(-1).messages;
  assert.ok(budgeted.reduce((total, item) => total + item.content.length, 0) <= 6000);
  assert.equal(budgeted.length, 9);
  assert.deepEqual(budgeted.map((item) => item.role), ["user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant", "user"]);
  assert.equal(budgeted[0].content, `${"问".repeat(199)}3`);
  assert.equal(budgeted.at(-1).content, "新".repeat(200));
  await ui.complete("收到新的话题");

  // 收起手机键盘的两帧等待期间停止：不得发请求，也不得误触发本地回复。
  const mobile = await browserFixture({ mobile: true });
  for (const mode of ["local", "deepseek"]) {
    mobile.select(mode); mobile.submit("眨眼");
    const length = mobile.ids.anonChatLog.children.length;
    mobile.ids.anonChatStop.dispatch("click");
    mobile.frame(); mobile.frame();
    await settle(() => !mobile.send.disabled, "手机等待阶段停止应恢复控件");
    assert.equal(mobile.requests.length, 0);
    assert.equal(mobile.ids.anonChatLog.children.length, length);
    assert.match(mobile.ids.anonChatState.textContent, /已停止/);
  }

  const gated = await browserFixture({ accessCodeRequired: true });
  gated.submit("你好");
  assert.equal(gated.requests.length, 0);
  assert.equal(gated.ids.anonChatAccessField.hidden, false);
  gated.ids.anonChatAccessCode.value = "站点测试口令🎸";
  gated.submit("你好");
  assert.equal(gated.requests[0].options.headers["X-Chat-Access-Code"], encodeURIComponent("站点测试口令🎸"));
  assert.equal(decodeURIComponent(new Headers(gated.requests[0].options.headers).get("X-Chat-Access-Code")), "站点测试口令🎸");
  assert.equal(gated.requests[0].options.body.includes("站点测试口令"), false);
  assert.equal(gated.requests[0].options.headers.Authorization, undefined);
  await gated.complete("欢迎来玩");
}

async function testEmotionFeedback() {
  const ui = await browserFixture();
  ui.submit("爱音真可爱");
  const shy = { type: "reaction", motion: "shame01", expression: "shame01", label: "害羞" };
  ui.requests.at(-1).write(shy);
  await settle(() => ui.ids.anonChatEmotion.textContent === "回应：害羞", "应在模型确认后显示情绪标签");
  assert.deepEqual({ ...ui.reactions.at(-1) }, shy);
  assert.match(ui.ids.anonChatEmotion.title, /已应用/);
  await ui.complete("突然夸我，有点不好意思啦。");

  const paused = await browserFixture({ modelReact: async () => ({ ok: false, reason: "模型已暂停" }) });
  paused.submit("眨眼");
  paused.requests.at(-1).write({ type: "reaction", motion: "wink01", expression: "wink01", label: "眨眼" });
  await settle(() => paused.ids.anonChatEmotion.textContent === "回应：眨眼 · 未播放", "暂停模型不能报告动作已播放");
  assert.equal(paused.ids.anonChatEmotion.title, "模型已暂停");
  await paused.complete("收到啦。");

  let fail = false;
  const failed = await browserFixture({ modelReact: async () => {
    if (fail) throw new Error("模型资源异常");
    return { ok: true };
  } });
  failed.submit("你好");
  await failed.complete("你好呀。");
  assert.match(failed.ids.anonChatEmotion.title, /已应用/);
  fail = true;
  failed.submit("微笑");
  await failed.complete("我听见了。");
  assert.match(failed.ids.anonChatEmotion.textContent, /未播放|暂不可用/);
  assert.doesNotMatch(failed.ids.anonChatEmotion.title || "", /已应用/, "失败状态不能保留上一轮成功的悬浮说明");

  // 手动决定模型异步调用的完成顺序，验证旧思考、旧轮次均不能回写新状态。
  const pending = [];
  const race = await browserFixture({ modelReact: (reaction) => new Promise((resolve, reject) => pending.push({ reaction, resolve, reject })) });
  race.submit("第一句");
  const thinking = pending.at(-1);
  race.requests.at(-1).write(shy);
  await settle(() => pending.length === 2, "应收到思考后的情绪动作");
  pending[1].resolve({ ok: true });
  await settle(() => race.ids.anonChatEmotion.textContent === "回应：害羞", "最新模型回调应写入状态");
  thinking.resolve({ ok: false, reason: "过期的思考动作" });
  await tick();
  assert.equal(race.ids.anonChatEmotion.textContent, "回应：害羞");
  await race.complete("第一句回答");
  const oldTurn = pending.at(-1);
  race.ids.anonChatClear.dispatch("click");
  assert.deepEqual({ ...pending.at(-1).reaction }, { motion: "idle01", expression: "default", label: "平静待机" });
  pending.at(-1).resolve({ ok: true });
  await settle(() => race.ids.anonChatEmotion.textContent === "回应：平静待机", "清空后应恢复待机");
  oldTurn.resolve({ ok: true });
  await tick();
  assert.equal(race.ids.anonChatEmotion.textContent, "回应：平静待机");

  race.submit("第二句");
  const stoppedThinking = pending.at(-1);
  race.requests.at(-1).write(shy);
  await settle(() => pending.at(-1).reaction.label === "害羞", "第二轮应收到情绪动作");
  const stoppedReaction = pending.at(-1);
  race.ids.anonChatStop.dispatch("click");
  assert.deepEqual({ ...pending.at(-1).reaction }, { motion: "idle01", expression: "default", label: "平静待机" });
  pending.at(-1).resolve({ ok: true });
  await settle(() => !race.send.disabled && race.ids.anonChatEmotion.textContent === "回应：平静待机", "停止后应恢复待机与发送控件");
  stoppedReaction.reject(new Error("停止后的旧动作失败"));
  stoppedThinking.resolve({ ok: true });
  await tick();
  assert.equal(race.ids.anonChatEmotion.textContent, "回应：平静待机");
}

(async () => {
  await testParser();
  await testClient();
  await testEmotionFeedback();
  console.log("聊天前端验证通过：UTF-8/NDJSON、生命周期竞争、历史预算、故障降级、口令编码、情绪动作实际结果与回调竞争。");
})().catch((error) => { console.error(error); process.exitCode = 1; });
