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

  // 回调异步播放时，同一个网络块的下一事件必须等待，不能越过动作展示文字。
  const ordered = [];
  let resume;
  const playing = readEvents(bytesStream([encoder.encode(expected.map(JSON.stringify).join("\n"))]), async (event) => {
    ordered.push(`start:${event.type}`);
    if (event.type === "reaction") await new Promise((resolve) => { resume = resolve; });
    ordered.push(`end:${event.type}`);
  });
  await settle(() => !!resume, "首个异步事件应开始");
  assert.deepEqual(ordered, ["start:reaction"]);
  resume(); await playing;
  assert.deepEqual(ordered, expected.flatMap((event) => [`start:${event.type}`, `end:${event.type}`]));

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
    this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 0;
  }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  dispatch(type, detail = {}) { this.listeners.get(type)?.({ preventDefault() {}, ...detail }); }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  replaceChildren() { this.children = []; }
  get firstElementChild() { return this.children[0]; }
  remove() { this.parent.children = this.parent.children.filter((child) => child !== this); }
  focus() { this.focused = true; }
  blur() {}
  scrollIntoView(options) { (this.scrollCalls ||= []).push(options); }
  getBoundingClientRect() { return this.bounds || { top: 0, bottom: 0 }; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch("close"); }
}

function playbackClock() {
  let now = 1000;
  let serial = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay) { const id = ++serial; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const end = now + ms;
      for (let count = 0; count < 10000; count++) {
        await tick();
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) { now = end; await tick(); return; }
        now = next[1].at; timers.delete(next[0]); next[1].callback();
      }
      throw new Error("测试时钟超出步数");
    },
  };
}

async function browserFixture({ accessCodeRequired = false, mobile = false, landscapeMobile = false, shortViewport = false, reducedMotion = true, clock, modelReact, modelWait, modelState, modelReady = true, mobileRoom } = {}) {
  const ids = Object.fromEntries([
    "anonChatForm", "anonChatInput", "anonChatLog", "anonChatState", "anonChatMode",
    "chatDisclosure", "anonChatStop", "anonChatClear", "anonChatAccessCode", "anonChatEmotion", "anonChatLatest",
    "anonChatAccessDialog", "anonChatAccessForm", "anonChatAccessError", "anonChatAccessSubmit", "anonChatAccessCancel", "anonChatUnlock", "anonChatLock", "anonRoom",
  ].map((id) => [id, new Element()]));
  const send = new Element();
  const aiOption = new Element(); aiOption.disabled = true;
  ids.anonChatMode.value = "local";
  ids.anonChatMode.querySelector = () => aiOption;
  ids.anonChatForm.querySelector = () => send;
  const requests = [];
  const unlocks = [];
  const reactions = [];
  const frames = [];
  const controls = new Element();
  controls.computedStyle = { overflowY: "auto", paddingTop: "16px" };
  let nextHttpError = null;
  const root = {
    document: {
      getElementById: (id) => ids[id],
      createElement: () => new Element(),
      querySelectorAll: () => [],
      querySelector: (selector) => selector === ".l2d-controls" ? controls : null,
    },
    location: { protocol: "https:" },
    matchMedia: (query) => ({ matches: query === "(prefers-reduced-motion: reduce)" ? reducedMotion :
      query === "(max-height: 600px)" ? shortViewport :
      query === "(max-width: 700px), (max-width: 960px) and (max-height: 500px) and (orientation: landscape)" ? mobile || landscapeMobile : false }),
    getComputedStyle: (element) => element.computedStyle,
    requestAnimationFrame: (callback) => { frames.push(callback); },
    AnonLive2D: {
      react: (reaction) => { reactions.push(reaction); return modelReact ? modelReact(reaction) : Promise.resolve({ ok: true }); },
      ...(modelWait ? { whenReactionComplete: modelWait } : {}),
      getState: () => ({ ready: modelReady, ...modelState?.() }),
    },
    ...(mobileRoom ? { AnonMobileRoom: mobileRoom } : {}),
    fetch: async (url, options = {}) => {
      assert.equal(url, "/api/chat");
      if (options.method !== "POST") return { ok: true, json: async () => ({ enabled: true, accessCodeRequired }) };
      // 使用真实 Headers，覆盖浏览器要求请求头值可转换为 ByteString 的边界。
      new Headers(options.headers);
      const payload = JSON.parse(options.body);
      if (payload.action === "unlock") {
        const attempt = { options };
        unlocks.push(attempt);
        // 特意不响应 abort，以验证过期验证结果也不能误解锁。
        return new Promise((resolve) => { attempt.resolve = (status = 200, body = { unlocked: true }) => resolve({ ok: status === 200, status, json: async () => body }); });
      }
      const request = { options, messages: payload.messages };
      requests.push(request);
      if (nextHttpError) {
        const error = nextHttpError; nextHttpError = null;
        return { ok: false, status: error.status, json: async () => ({ error: error.message }) };
      }
      request.body = new ReadableStream({
        start(controller) {
          request.write = (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          request.writeChunk = (events) => controller.enqueue(encoder.encode(`${events.map(JSON.stringify).join("\n")}\n`));
          request.close = () => controller.close();
          options.signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
        },
      });
      return { ok: true, headers: new Headers({ "content-type": "application/x-ndjson; charset=utf-8" }), body: request.body };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assets/js/anon-dialogue.js"), "utf8"), {
    window: root, AbortController, AbortSignal, TextDecoder,
    setTimeout: clock ? clock.setTimeout : setTimeout, clearTimeout: clock ? clock.clearTimeout : clearTimeout,
    ...(clock ? { Date: { now: clock.now } } : {}),
  }, { filename: "anon-dialogue.js" });
  await settle(() => !aiOption.disabled, "AI 配置应启用选项");
  return {
    ids, requests, unlocks, reactions, send, controls,
    frame() { frames.splice(0).forEach((callback) => callback()); },
    submit(text) { ids.anonChatInput.value = text; ids.anonChatForm.dispatch("submit"); },
    select(value) { ids.anonChatMode.value = value; ids.anonChatMode.dispatch("change"); },
    failNext(message, status = 503) { nextHttpError = { message, status }; },
    unlock(password) { ids.anonChatAccessCode.value = password; ids.anonChatAccessForm.dispatch("submit"); },
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
  assert.equal(ui.reactions.at(-1).source, "chat", "本地对话也应使用聊天动作候选");
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
  assert.equal(ui.reactions.at(-1).source, "chat", "本地降级回复仍是对话反应");
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

}

async function testPasswordLock() {
  const ui = await browserFixture({ accessCodeRequired: true });
  const ids = ui.ids;
  assert.ok(!ids.anonChatAccessDialog.open, "载入页面不应弹窗");
  assert.equal(ids.anonChatUnlock.hidden, false);
  assert.equal(ids.anonChatLock.hidden, true);
  ui.submit("你好");
  assert.equal(ui.requests.length, 0, "锁定时不能调用模型");
  assert.equal(ids.anonChatInput.value, "你好", "先解锁时保留待发送文字");
  assert.equal(ids.anonChatAccessDialog.open, true);
  ui.unlock("wrong");
  assert.equal(ids.anonChatAccessSubmit.disabled, true);
  ui.unlock("duplicate");
  assert.equal(ui.unlocks.length, 1, "验证时禁止重复提交");
  ui.unlocks[0].resolve(401, { error: "Unauthorized" });
  await settle(() => !ids.anonChatAccessSubmit.disabled, "错密码后可重试");
  assert.match(ids.anonChatAccessError.textContent, /密码不正确/);
  assert.equal(ids.anonChatAccessDialog.open, true);
  assert.equal(ids.anonChatAccessCode.value, "");
  ui.unlock("test"); ui.unlocks.at(-1).resolve(200, { unlocked: false });
  await settle(() => !ids.anonChatAccessSubmit.disabled, "缺少成功字段也应报错");
  assert.equal(ids.anonChatUnlock.hidden, false);
  assert.match(ids.anonChatAccessError.textContent, /无法验证/);
  ui.unlock("test"); ui.unlocks.at(-1).resolve(429, {});
  await settle(() => !ids.anonChatAccessSubmit.disabled, "限流后应恢复控件");
  assert.match(ids.anonChatAccessError.textContent, /频繁/);

  for (const cancelEvent of ["cancel", "button", "mode"]) {
    ids.anonChatUnlock.dispatch("click");
    ui.unlock("pending secret");
    const pending = ui.unlocks.at(-1);
    if (cancelEvent === "mode") ui.select("local");
    else if (cancelEvent === "button") ids.anonChatAccessCancel.dispatch("click");
    else ids.anonChatAccessDialog.dispatch("cancel");
    assert.equal(pending.options.signal.aborted, true);
    assert.equal(ids.anonChatAccessCode.value, "");
    assert.equal(ids.anonChatAccessDialog.open, false);
    pending.resolve(); await tick();
    assert.equal(ids.anonChatLock.hidden, true, "取消后的迟到成功不得解锁");
    if (cancelEvent === "mode") {
      ui.submit("眨眼"); assert.match(ui.lastText(), /Wink/);
      ui.select("deepseek");
      assert.equal(ids.anonChatAccessDialog.open, true, "选择 AI 时提示输入密码");
    }
  }
  ui.unlock("older attempt");
  const olderAttempt = ui.unlocks.at(-1);
  ids.anonChatAccessCancel.dispatch("click");
  ids.anonChatUnlock.dispatch("click");
  ui.unlock("newer attempt");
  olderAttempt.resolve(); await tick();
  assert.equal(ids.anonChatAccessDialog.open, true, "旧请求不得关闭新弹窗");
  assert.equal(ids.anonChatAccessSubmit.disabled, true, "旧 finally 不得结束新验证状态");
  assert.equal(ids.anonChatLock.hidden, true);
  ui.unlocks.at(-1).resolve(401, {});
  await settle(() => !ids.anonChatAccessSubmit.disabled, "新验证结果独立处理");
  const password = "站点测试口令🎸";
  ui.unlock(password); ui.unlocks.at(-1).resolve();
  await settle(() => ids.anonChatLock.hidden === false, "正确密码应解锁");
  assert.equal(ids.anonChatAccessDialog.open, false);
  assert.equal(ids.anonChatAccessCode.value, "", "成功后输入框也不保留密码");
  assert.equal(ids.anonChatUnlock.hidden, true);
  assert.deepEqual(JSON.parse(ui.unlocks.at(-1).options.body), { action: "unlock" });
  ui.submit("你好");
  assert.equal(ui.requests[0].options.headers["X-Chat-Access-Code"], encodeURIComponent(password));
  assert.equal(decodeURIComponent(new Headers(ui.requests[0].options.headers).get("X-Chat-Access-Code")), password);
  assert.equal(ui.requests[0].options.body.includes("站点测试口令"), false);
  assert.equal(ui.requests[0].options.headers.Authorization, undefined);
  await ui.complete("欢迎来玩");

  ui.failNext("密码不正确", 401); ui.submit("未授权时眨眼");
  await settle(() => !ui.send.disabled, "401 应结束请求");
  assert.equal(ui.lastText(), "未授权时眨眼", "未授权不能返回本地预设伪装成功");
  assert.equal(ids.anonChatLock.hidden, true);
  assert.equal(ids.anonChatAccessDialog.open, true);
  assert.match(ids.anonChatAccessError.textContent, /重新解锁/);
  const count = ui.requests.length;
  ui.submit("仍在锁定"); assert.equal(ui.requests.length, count);
  ui.unlock(password); ui.unlocks.at(-1).resolve();
  await settle(() => !ids.anonChatLock.hidden, "应能重新解锁");
  ui.submit("重新开始");
  assert.deepEqual(ui.requests.at(-1).messages, [{ role: "user", content: "重新开始" }], "重新鉴权后清除旧对话上下文");
  const streaming = ui.requests.at(-1);
  ids.anonChatLock.dispatch("click");
  await tick();
  assert.equal(streaming.options.signal.aborted, true);
  assert.equal(ids.anonChatUnlock.hidden, false);
  assert.equal(ids.anonChatLock.hidden, true);
  assert.equal(ids.anonChatAccessCode.value, "");
  ui.submit("重新锁定之后"); assert.equal(ui.requests.length, count + 1);
  ui.unlock(password); ui.unlocks.at(-1).resolve();
  await settle(() => !ids.anonChatLock.hidden, "重锁后可重新解锁");
  ui.select("local"); ui.submit("眨眼");
  assert.match(ui.lastText(), /Wink/);
  ui.select("deepseek");
  assert.equal(ids.anonChatAccessDialog.open, true, "切换到本地模式后清除原解锁口令");
  ui.submit("切回后"); assert.equal(ui.requests.length, count + 1);
  const refreshed = await browserFixture({ accessCodeRequired: true });
  refreshed.submit("刷新之后");
  assert.equal(refreshed.requests.length, 0, "新页面不能继承解锁状态");
}

async function testEmotionFeedback() {
  const ui = await browserFixture();
  ui.submit("爱音真可爱");
  const shy = { type: "reaction", motion: "shame01", expression: "shame01", label: "害羞" };
  ui.requests.at(-1).write(shy);
  await settle(() => ui.ids.anonChatEmotion.textContent === "回应：害羞", "应在模型确认后显示情绪标签");
  const { signal: shySignal, ...shyPlayed } = ui.reactions.at(-1);
  assert.deepEqual(shyPlayed, { ...shy, source: "chat" });
  assert.equal(shySignal, ui.requests.at(-1).options.signal);
  assert.match(ui.ids.anonChatEmotion.title, /已应用/);
  await ui.complete("突然夸我，有点不好意思啦。");

  const paused = await browserFixture({ modelReact: async () => ({ ok: false, reason: "模型已暂停" }) });
  paused.submit("眨眼");
  paused.requests.at(-1).write({ type: "reaction", motion: "wink01", expression: "wink01", label: "眨眼" });
  await settle(() => paused.ids.anonChatEmotion.textContent === "回应：眨眼 · 未播放", "暂停模型不能报告动作已播放");
  assert.equal(paused.ids.anonChatEmotion.title, "模型已暂停");
  await paused.complete("收到啦。");

  // 使用真实舞台清单和语义解析器，避免仅mock成功而掩盖“所有情绪都映射到待机”。
  const costumesContext = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assets/data/anon-live2d.js"), "utf8"), costumesContext);
  const costume = costumesContext.window.ANON_LIVE2D.costumes.find((item) => item.mode === "performance");
  const actions = require("../assets/js/live2d-actions.js");
  const actualActions = [];
  const performance = await browserFixture({ modelReact: async (reaction) => {
    const choice = actions.resolve(costume, reaction);
    assert.ok(choice, "舞台模型必须解析出真实动作");
    const action = costume.performanceActions.find((item) => item.motion === choice.motion);
    assert.ok(action, "已执行动作应有对应的真实按钮名称");
    actualActions.push(choice);
    return { ok: true, mode: costume.mode, motion: choice.motion, expression: choice.expression, actionLabel: action.label };
  } });
  performance.submit("演奏时聊一聊");
  performance.requests.at(-1).writeChunk([
    { ...shy, emotion: "shy" }, { type: "delta", text: "突然这么说，还挺不好意思的。" }, { type: "done" },
  ]);
  performance.requests.at(-1).close();
  await settle(() => !performance.send.disabled, "演奏模式也应正常完成聊天");
  const shyAction = costume.performanceActions.find((item) => item.motion === actualActions.at(-1).motion);
  assert.equal(performance.ids.anonChatEmotion.textContent, `回应：${shyAction.label}`);
  assert.match(performance.ids.anonChatEmotion.title, /本轮语气：害羞.*没有独立表情/);
  assert.equal(performance.reactions.at(-1).emotion, "shy", "模型能力只影响状态说明，不能改写聊天情绪语义");

  const ordinary = "刚从便利店回来，买了一副新的耳机。";
  assert.equal(require("../assets/js/anon-dialogue.js").reply(ordinary).label, "认真倾听", "普通聊天不依赖本地动作关键词");
  performance.submit(ordinary);
  assert.equal(performance.requests.at(-1).messages.at(-1).content, require("../assets/js/anon-dialogue.js").normalize(ordinary));
  performance.requests.at(-1).writeChunk([
    { type: "reaction", emotion: "smile", motion: "smile01", expression: "smile01", label: "微笑" },
    { type: "delta", text: "诶，新耳机！有试过用它听喜欢的歌吗？" }, { type: "done" },
  ]);
  performance.requests.at(-1).close();
  await settle(() => !performance.send.disabled, "无关键词的普通AI聊天也应完成演奏动作");
  assert.equal(performance.reactions.at(-1).emotion, "smile", "动作必须由AI响应情绪驱动");
  assert.notEqual(actualActions.at(-1).motion, costume.defaultMotion, "普通聊天的微笑回应应触发实际演奏，不能全部退回待机");
  const ordinaryAction = costume.performanceActions.find((item) => item.motion === actualActions.at(-1).motion);
  assert.equal(performance.ids.anonChatEmotion.textContent, `回应：${ordinaryAction.label}`);
  assert.match(performance.ids.anonChatEmotion.title, /本轮语气：微笑.*已触发舞台动作/);

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
  race.requests.at(-1).writeChunk([
    { type: "reaction", motion: "smile01", expression: "smile01", label: "微笑" },
    { type: "delta", text: "第一句回答" }, { type: "done" },
  ]);
  race.requests.at(-1).close();
  await settle(() => pending.at(-1).reaction.label === "微笑", "后续正文应等待新动作");
  const oldTurn = pending.at(-1);
  assert.equal(race.lastText(), "第一句", "未完成的动作不能提前显示后续正文");
  race.ids.anonChatClear.dispatch("click");
  assert.deepEqual({ ...pending.at(-1).reaction }, { motion: "idle01", expression: "default", label: "平静待机", source: "control" });
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
  assert.deepEqual({ ...pending.at(-1).reaction }, { motion: "idle01", expression: "default", label: "平静待机", source: "control" });
  pending.at(-1).resolve({ ok: true });
  await settle(() => !race.send.disabled && race.ids.anonChatEmotion.textContent === "回应：平静待机", "停止后应恢复待机与发送控件");
  stoppedReaction.reject(new Error("停止后的旧动作失败"));
  stoppedThinking.resolve({ ok: true });
  await tick();
  assert.equal(race.ids.anonChatEmotion.textContent, "回应：平静待机");
}

async function testSegmentPlayback() {
  const clock = playbackClock();
  const pending = [];
  const shy = { type: "reaction", emotion: "shy", motion: "shame01", expression: "shame01", label: "害羞" };
  const smile = { type: "reaction", emotion: "smile", motion: "smile01", expression: "smile01", label: "微笑" };
  const ui = await browserFixture({ reducedMotion: false, clock, modelReact: (reaction) => {
    if (reaction.type !== "reaction") return Promise.resolve({ ok: true });
    return new Promise((resolve) => pending.push({ reaction, resolve, at: clock.now() }));
  } });
  ui.submit("分段回答");
  const request = ui.requests.at(-1);
  // 一次收到完整响应，仍须按动作、文字、下一动作的顺序播放。
  request.writeChunk([shy, { type: "delta", text: "先" }, shy, { type: "delta", text: "。" }, smile, { type: "delta", text: "后。" }, { type: "done" }]);
  request.close();
  await settle(() => pending.length === 1, "首段动作应开始");
  assert.equal(ui.lastText(), "分段回答");
  assert.equal(ui.send.disabled, true, "网络已结束但动作未完成时仍应忙碌");
  pending[0].resolve({ ok: true });
  await settle(() => ui.lastText() === "先", "动作就绪后才逐字显示正文");
  await clock.advance(19);
  assert.equal(ui.lastText(), "先");
  await clock.advance(1);
  assert.equal(ui.lastText(), "先。", "相邻 delta 不应各自等待最短情绪停留");
  assert.equal(pending.length, 1, "重复相同情绪不得重新触发动作");
  await clock.advance(679);
  assert.equal(pending.length, 1, "短句情绪应至少保留 700 毫秒");
  await clock.advance(1);
  assert.equal(pending.length, 2);
  assert.equal(pending[1].at - pending[0].at, 700);
  assert.equal(ui.lastText(), "先。", "下一段文字必须等待下一动作就绪");
  pending[1].resolve({ ok: true });
  await settle(() => ui.lastText() === "先。后", "第二段开始显示");
  assert.equal(ui.send.disabled, true, "文字未播放完不得写入历史或允许新请求");
  await clock.advance(40);
  assert.equal(ui.lastText(), "先。后。");
  assert.equal(ui.send.disabled, false);
  ui.submit("追问");
  assert.deepEqual(ui.requests.at(-1).messages.map((item) => item.content), ["分段回答", "先。后。", "追问"]);
  ui.ids.anonChatStop.dispatch("click");
  await tick();

  // 网络数据已全部缓冲时，停止、清空、模式切换和重锁仍应立刻取消播放队列。
  for (const action of ["stop", "clear", "mode", "lock"]) {
    const time = playbackClock();
    const cancelled = await browserFixture({ accessCodeRequired: true, reducedMotion: false, clock: time });
    cancelled.ids.anonChatUnlock.dispatch("click");
    cancelled.unlock("test-only"); cancelled.unlocks.at(-1).resolve();
    await settle(() => !cancelled.ids.anonChatLock.hidden, "播放测试先解锁");
    cancelled.submit("旧问题");
    const old = cancelled.requests.at(-1);
    old.writeChunk([shy, { type: "delta", text: "这一段还没说完" }, smile, { type: "delta", text: "后段不应播放" }, { type: "done" }]); old.close();
    await settle(() => cancelled.lastText() === "这", "先显示一个字后取消");
    if (action === "mode") cancelled.select("local");
    else cancelled.ids[{ stop: "anonChatStop", clear: "anonChatClear", lock: "anonChatLock" }[action]].dispatch("click");
    await settle(() => !cancelled.send.disabled, "取消播放应立即恢复控件");
    const afterCancel = cancelled.lastText();
    await time.advance(3000);
    assert.equal(old.options.signal.aborted, true);
    assert.equal(cancelled.lastText(), afterCancel, `${action} 后旧文字不能继续显示`);
    assert.equal(cancelled.reactions.some((value) => value.emotion === "smile"), false, `${action} 后不能触发缓冲中的下一动作`);
    if (action === "mode") cancelled.select("deepseek");
    if (action === "mode" || action === "lock") {
      cancelled.ids.anonChatUnlock.dispatch("click");
      cancelled.unlock("test-only"); cancelled.unlocks.at(-1).resolve();
      await settle(() => !cancelled.ids.anonChatLock.hidden, "重新解锁后检查历史");
    }
    cancelled.submit("新问题");
    assert.deepEqual(cancelled.requests.at(-1).messages, [{ role: "user", content: "新问题" }], "未播完的回复不能进入后续历史");
    cancelled.ids.anonChatStop.dispatch("click");
    await tick();
  }
}

async function testActualMotionCompletion() {
  let releaseStart;
  let releaseCompletion;
  let playing = false;
  const waits = [];
  const ui = await browserFixture({
    modelReact: (reaction) => {
      playing = true;
      if (reaction.label === "思考") return new Promise((resolve) => { releaseStart = resolve; });
      return Promise.resolve({ ok: true });
    },
    modelWait: (signal) => {
      waits.push(signal);
      if (!playing) return Promise.resolve();
      return new Promise((resolve) => { releaseCompletion = () => { playing = false; resolve(); }; });
    },
  });
  const shy = { type: "reaction", emotion: "shy", motion: "shame01", expression: "shame01", label: "害羞" };
  const sad = { type: "reaction", emotion: "sad", motion: "sad01", expression: "sad01", label: "难过" };
  ui.submit("先害羞再难过");
  await settle(() => !!releaseStart, "等待思考表情资源启动");
  const stream = ui.requests.at(-1);
  stream.writeChunk([shy, { type: "delta", text: "先。" }, sad, { type: "delta", text: "后。" }, { type: "done" }]); stream.close();
  await tick();
  assert.equal(ui.reactions.length, 1, "上一表情仍在加载时不启动下一动作");
  assert.equal(ui.reactions[0].motion, undefined, "请求等待只切思考表情，不插入长动作");
  releaseStart({ ok: true });
  await settle(() => !!releaseCompletion, "加载完成后仍等表情过渡结束");
  assert.equal(ui.reactions.length, 1);
  releaseCompletion(); releaseCompletion = null;
  await settle(() => ui.lastText() === "先。" && !!releaseCompletion, "首段播放后等待真实动作结束");
  assert.equal(ui.reactions.at(-1).emotion, "shy", "网络一次发完也不能提前启动下一段");
  assert.equal(ui.send.disabled, true);
  releaseCompletion(); releaseCompletion = null;
  await settle(() => !ui.send.disabled, "完成门控后继续正文");
  assert.equal(ui.lastText(), "先。后。");
  assert.equal(ui.reactions.at(-1).emotion, "sad");
  assert.ok(waits.every((signal) => signal === stream.options.signal));

  for (const action of ["stop", "clear", "mode", "lock"]) {
    let unblock;
    let active = false;
    const cancelled = await browserFixture({
      modelReact: async () => { active = true; return { ok: true }; },
      modelWait: () => active ? new Promise((resolve) => { unblock = resolve; }) : Promise.resolve(),
    });
    cancelled.submit("取消等待");
    await settle(() => active, "思考表情开始后再触发缓冲内容");
    const old = cancelled.requests.at(-1);
    old.writeChunk([sad, { type: "delta", text: "不应出现" }, { type: "done" }]); old.close();
    await settle(() => !!unblock, "应等待上一动作实际结束");
    if (action === "mode") cancelled.select("local");
    else cancelled.ids[{ stop: "anonChatStop", clear: "anonChatClear", lock: "anonChatLock" }[action]].dispatch("click");
    await settle(() => !cancelled.send.disabled, "取消不得卡在模型完成等待");
    const after = cancelled.lastText();
    unblock(); await tick();
    assert.equal(cancelled.lastText(), after);
    assert.equal(cancelled.reactions.some((reaction) => reaction.emotion === "sad"), false, `${action}后迟到的完成信号不能复活旧动作`);
  }
}

async function testLongReplyContinuation() {
  const reaction = { type: "reaction", emotion: "smile", motion: "smile01", expression: "smile01", label: "微笑" };
  const paragraph = `${"这".repeat(224)}。`;
  const text = paragraph.repeat(4);
  const clock = playbackClock();
  const calls = [];
  const ui = await browserFixture({ reducedMotion: false, clock, modelReact: async (value) => {
    calls.push({ ...value, at: clock.now() });
    return { ok: true };
  } });
  ui.submit("刚从便利店回来，买了一副新的耳机。");
  assert.equal(calls[0].source, "chat", "AI思考也使用聊天动作");
  ui.requests.at(-1).writeChunk([reaction, { type: "delta", text }, { type: "done" }]);
  ui.requests.at(-1).close();
  await settle(() => ui.lastText() === "这", "长回复应逐字显示");
  await clock.advance(4499);
  assert.equal(calls.filter((item) => item.continuation).length, 0, "不足4.5秒不得续接");
  await clock.advance(1);
  assert.equal(calls.filter((item) => item.continuation).length, 1);
  await clock.advance(13500);
  assert.equal(ui.lastText(), text, "续接不改变正文或截断标点");
  assert.equal(ui.send.disabled, false);
  const continued = calls.filter((item) => item.continuation);
  assert.equal(continued.length, 4, "老播放器仍按4.5秒句读续接，但不能在第三次后一直待机");
  assert.deepEqual(continued.map((item) => item.at), [5500, 10000, 14500, 19000]);
  for (const value of continued) {
    assert.equal(value.source, "chat");
    assert.equal(value.emotion, "smile");
    assert.equal(value.motion, reaction.motion);
    assert.equal(value.expression, reaction.expression);
    assert.equal(value.signal, ui.requests.at(-1).options.signal);
  }
  await clock.advance(30000);
  assert.equal(calls.filter((item) => item.continuation).length, 4, "回复结束后不能后台触发动作");
  ui.submit("继续聊");
  assert.equal(ui.requests.at(-1).messages[1].content, text, "续接不改变已完成的对话历史");
  ui.ids.anonChatStop.dispatch("click"); await tick();
  assert.equal(calls.at(-1).source, "control", "停止复位不得参与聊天轮换");

  // 短回复、减少动态效果均不附加动作；网络静默时也没有后台动作计时器。
  for (const reducedMotion of [false, true]) {
    const time = playbackClock();
    const simple = await browserFixture({ reducedMotion, clock: time });
    simple.submit("普通问题");
    simple.requests.at(-1).writeChunk([reaction, { type: "delta", text: reducedMotion ? text : "知道啦。" }, { type: "done" }]);
    simple.requests.at(-1).close();
    await time.advance(20000);
    assert.equal(simple.send.disabled, false);
    assert.equal(simple.reactions.some((value) => value.continuation), false);
  }
  const waitingClock = playbackClock();
  const waiting = await browserFixture({ reducedMotion: false, clock: waitingClock });
  waiting.submit("普通问题");
  waiting.requests.at(-1).writeChunk([reaction, { type: "delta", text: "还在继续" }]);
  await waitingClock.advance(5000);
  assert.equal(waiting.reactions.some((value) => value.continuation), false, "没有新文字句读时不能自行续接");
  waiting.requests.at(-1).writeChunk([{ type: "delta", text: "。" }, { type: "done" }]); waiting.requests.at(-1).close();
  await waitingClock.advance(20);
  assert.equal(waiting.reactions.filter((value) => value.continuation).length, 1, "到达句读才延续当前语气");
  assert.equal(waiting.send.disabled, false);

  // 续接动作尚未完成时取消，后来的模型结果、正文和下一续接都不能复活旧一轮。
  for (const action of ["stop", "clear", "mode", "lock"]) {
    const time = playbackClock();
    let pending;
    const cancelled = await browserFixture({ accessCodeRequired: true, reducedMotion: false, clock: time, modelReact: (value) => {
      if (!value.continuation) return Promise.resolve({ ok: true });
      return new Promise((resolve) => { pending = { value, resolve }; });
    } });
    cancelled.ids.anonChatUnlock.dispatch("click");
    cancelled.unlock("test-only"); cancelled.unlocks.at(-1).resolve();
    await settle(() => !cancelled.ids.anonChatLock.hidden, "续接取消测试先解锁");
    cancelled.submit("普通问题");
    cancelled.requests.at(-1).writeChunk([reaction, { type: "delta", text }, { type: "done" }]); cancelled.requests.at(-1).close();
    await time.advance(4500);
    assert.ok(pending, "应进入尚未结束的续接动作");
    if (action === "mode") cancelled.select("local");
    else cancelled.ids[{ stop: "anonChatStop", clear: "anonChatClear", lock: "anonChatLock" }[action]].dispatch("click");
    await settle(() => !cancelled.send.disabled, "取消续接应立即退出忙碌");
    assert.equal(pending.value.signal.aborted, true);
    assert.equal(cancelled.reactions.at(-1).source, "control");
    const after = cancelled.lastText();
    pending.resolve({ ok: true });
    await time.advance(20000);
    assert.equal(cancelled.lastText(), after, "迟到续接不能继续播放文字");
    assert.equal(cancelled.reactions.filter((value) => value.continuation).length, 1, "取消后不能再触发后续动作");
    assert.equal(cancelled.ids.anonChatEmotion.textContent, "回应：平静待机");
    if (action === "mode") cancelled.select("deepseek");
    if (action === "mode" || action === "lock") {
      cancelled.ids.anonChatUnlock.dispatch("click");
      cancelled.unlock("test-only"); cancelled.unlocks.at(-1).resolve();
      await settle(() => !cancelled.ids.anonChatLock.hidden, "重新解锁检查未完成历史");
    }
    cancelled.submit("新问题");
    assert.deepEqual(cancelled.requests.at(-1).messages, [{ role: "user", content: "新问题" }]);
    cancelled.ids.anonChatStop.dispatch("click"); await tick();
  }
}

async function testModelAwareContinuation() {
  const neutral = { type: "reaction", emotion: "neutral", motion: "idle01", expression: "default", label: "平静待机" };
  const sentence = `${"这".repeat(19)}。`;
  const clock = playbackClock();
  let motionStarted = null;
  const calls = [];
  const ui = await browserFixture({ reducedMotion: false, clock,
    modelState: () => ({ reactionReady: motionStarted !== null && clock.now() - motionStarted >= 1600 }),
    modelReact: async (value) => {
      if (value.type === "reaction") {
        motionStarted = clock.now();
        calls.push({ ...value, at: motionStarted });
      }
      return { ok: true };
    },
  });
  ui.submit("请平静地说一段完整的话");
  const reply = sentence.repeat(32);
  const request = ui.requests.at(-1);
  request.writeChunk([neutral, { type: "delta", text: reply }, { type: "done" }]); request.close();
  await settle(() => ui.lastText() === "这", "按真实进度续接时仍逐字输出");
  await clock.advance(1599);
  assert.equal(calls.length, 1, "2秒动作未达80%前不能因多个句读而提前续接");
  await clock.advance(1);
  assert.equal(calls.length, 2, "2秒动作达80%后的自然句读立即续接，不空等4.5秒");
  assert.equal(calls[1].at - calls[0].at, 1600);
  await clock.advance(11200);
  assert.equal(ui.lastText(), reply);
  assert.equal(ui.send.disabled, false);
  const continued = calls.filter((value) => value.continuation);
  assert.equal(continued.length, 8, "完整长回复的第四次之后也继续按实际动作进度回应");
  for (const value of continued) {
    assert.equal(value.emotion, "neutral", "中性正文续接不擅自改为开心语气");
    assert.equal(value.motion, neutral.motion);
    assert.equal(value.expression, neutral.expression);
    assert.equal(value.source, "chat");
    assert.equal(value.signal, request.options.signal);
  }
  await clock.advance(30000);
  assert.equal(calls.length, 9, "播放已结束后没有后台续接计时器");

  // 动作很短时仍保留1.2秒最小间隔；达到80%不代表可以逐标点重启。
  const quickClock = playbackClock();
  const quick = await browserFixture({ reducedMotion: false, clock: quickClock,
    modelState: () => ({ reactionReady: true }),
  });
  quick.submit("短动作不要频繁重启");
  quick.requests.at(-1).writeChunk([neutral, { type: "delta", text: sentence.repeat(10) }, { type: "done" }]); quick.requests.at(-1).close();
  await settle(() => quick.lastText() === "这", "短动作回复应开始");
  await quickClock.advance(1199);
  assert.equal(quick.reactions.filter((value) => value.continuation).length, 0, "就绪状态也必须遵守1.2秒间隔");
  await quickClock.advance(1);
  assert.equal(quick.reactions.filter((value) => value.continuation).length, 1);
  quick.ids.anonChatStop.dispatch("click");
  await settle(() => !quick.send.disabled, "停止应释放播放队列");
  const stoppedText = quick.lastText();
  await quickClock.advance(10000);
  assert.equal(quick.lastText(), stoppedText);
  assert.equal(quick.reactions.filter((value) => value.continuation).length, 1, "停止之后不得有续接动作");

  // 新播放器明确未就绪时不能走老版4500ms回退，避免暂停或长动作被打断。
  const delayedClock = playbackClock();
  let ready = false;
  const delayed = await browserFixture({ reducedMotion: false, clock: delayedClock,
    modelState: () => ({ reactionReady: ready }),
  });
  delayed.submit("上一动作还未到衔接点");
  delayed.requests.at(-1).writeChunk([neutral, { type: "delta", text: sentence.repeat(25) }, { type: "done" }]); delayed.requests.at(-1).close();
  await settle(() => delayed.lastText() === "这", "长动作回复应开始");
  await delayedClock.advance(6000);
  assert.equal(delayed.reactions.filter((value) => value.continuation).length, 0, "明确未达80%时超过4.5秒也不能续接");
  ready = true;
  await delayedClock.advance(400);
  assert.equal(delayed.reactions.filter((value) => value.continuation).length, 1, "就绪后等下一个自然句读才续接");
  delayed.ids.anonChatStop.dispatch("click");
  await settle(() => !delayed.send.disabled, "结束延迟就绪场景");
}

async function testReadingAndComposition() {
  const ui = await browserFixture();
  const { anonChatLog: log, anonChatLatest: latest, anonChatInput: input } = ui.ids;
  log.scrollHeight = 1000; log.clientHeight = 240;
  ui.submit('请慢慢回答');
  log.scrollTop = 80;
  log.dispatch('scroll');
  ui.requests.at(-1).write({ type: 'delta', text: '第一段内容。' });
  await settle(() => ui.lastText() === '第一段内容。', '应显示新增回复');
  assert.equal(log.scrollTop, 80, '阅读旧消息时不得强制跳到底部');
  assert.equal(latest.hidden, false, '离开底部后有新内容应提示');
  latest.dispatch('click');
  assert.equal(log.scrollTop, 1000);
  assert.equal(latest.hidden, true);
  log.scrollHeight = 1200;
  ui.requests.at(-1).write({ type: 'delta', text: '第二段内容。' });
  await settle(() => ui.lastText().includes('第二段'), '应继续接收正文');
  assert.equal(log.scrollTop, 1200, '主动查看最新后应恢复跟随');
  log.scrollTop = 20; log.dispatch('scroll');
  ui.ids.anonChatClear.dispatch('click');
  assert.equal(latest.hidden, true, '清空应重置未读提示');
  await settle(() => !ui.send.disabled, '清空应停止请求');
  input.dispatch('compositionstart');
  let prevented = false;
  input.dispatch('keydown', { key: 'Enter', isComposing: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true, '候选字确认键不得隐式提交');
  const before = ui.requests.length;
  ui.submit('正在拼写');
  assert.equal(ui.requests.length, before, '输入法组合未结束不得发送');
  input.dispatch('compositionend');
  ui.submit('完成输入');
  assert.equal(ui.requests.length, before + 1);
  await ui.complete('收到啦！');
}

async function testCompactMobileScroll() {
  const prepare = (ui) => {
    ui.controls.scrollHeight = 900; ui.controls.clientHeight = 240;
    ui.controls.bounds = { top: 260, bottom: 500 };
    ui.ids.anonChatLog.bounds = { top: 520, bottom: 680 };
  };
  for (const options of [{ mobile: true }, { landscapeMobile: true }]) {
    for (const mode of ["local", "deepseek"]) {
      const ui = await browserFixture({ ...options, shortViewport: true });
      prepare(ui); ui.select(mode); ui.submit("你好");
      assert.equal(ui.controls.scrollTop, 0, "先保持现有回到房间顶部逻辑");
      assert.equal(ui.ids.anonRoom.scrollCalls.length, 1);
      assert.equal(ui.ids.anonRoom.scrollCalls[0].block, "start");
      assert.equal(ui.requests.length, 0, "两帧布局稳定前不发送请求");
      ui.frame(); ui.controls.scrollTop = 30; ui.frame();
      await settle(() => ui.controls.scrollTop === 274, "短屏仅滚动controls到日志顶附近，计入原scrollTop与padding");
      assert.equal(ui.ids.anonChatLog.scrollCalls, undefined, "禁止log.scrollIntoView把模型推出视口");
      assert.equal(ui.ids.anonRoom.scrollCalls.length, 1, "内部调整不增加外部页面跳转");
      if (mode === "deepseek") { await settle(() => ui.requests.length === 1, "AI请求应继续"); await ui.complete("收到啦"); }
      else await settle(() => !ui.send.disabled, "本地回复应继续");
    }
  }
  for (const bounds of [{ top: -100, expected: 0 }, { top: 3000, expected: 660 }]) {
    const ui = await browserFixture({ mobile: true, shortViewport: true });
    prepare(ui); ui.ids.anonChatLog.bounds = { top: bounds.top }; ui.select("local"); ui.submit("你好");
    ui.frame(); ui.frame(); await settle(() => !ui.send.disabled, "边界场景完成本地回复");
    assert.equal(ui.controls.scrollTop, bounds.expected, "滚动位置限制在面板有效范围内");
  }
  for (const action of ["stop", "clear", "mode", "lock"]) {
    const ui = await browserFixture({ mobile: true, shortViewport: true });
    prepare(ui); ui.select("local"); ui.submit("你好");
    if (action === "mode") ui.select("deepseek");
    else ui.ids[{ stop: "anonChatStop", clear: "anonChatClear", lock: "anonChatLock" }[action]].dispatch("click");
    ui.controls.scrollTop = 75;
    ui.frame(); ui.frame(); await tick();
    assert.equal(ui.controls.scrollTop, 75, `${action}后旧请求不得再次滚动面板`);
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.send.disabled, false);
  }
  for (const option of ["tall", "fits", "visible", "desktop"]) {
    const ui = await browserFixture({ mobile: option !== "desktop", shortViewport: option !== "tall" });
    prepare(ui);
    if (option === "fits") ui.controls.scrollHeight = ui.controls.clientHeight;
    if (option === "visible") ui.controls.computedStyle.overflowY = "visible";
    ui.select("local"); ui.submit("你好");
    ui.controls.scrollTop = 25;
    ui.frame(); ui.frame(); await tick();
    assert.equal(ui.controls.scrollTop, 25, `${option}不进行短屏内部定位`);
    if (option === "desktop") assert.equal(ui.ids.anonRoom.scrollCalls, undefined);
  }
}

async function testMobileOverlayChat() {
  for (const layout of [{ mobile: true }, { landscapeMobile: true }]) {
    for (const mode of ["local", "deepseek"]) {
      let prepared = 0;
      const ui = await browserFixture({ ...layout, shortViewport: true,
        mobileRoom: { prepareChat() { prepared++; return true; } },
      });
      ui.controls.scrollTop = 75;
      ui.controls.scrollHeight = 900; ui.controls.clientHeight = 240;
      ui.controls.bounds = { top: 260, bottom: 500 };
      ui.ids.anonChatLog.bounds = { top: 520, bottom: 680 };
      ui.select(mode); ui.submit("眨眼");
      assert.equal(prepared, 1, "发送时应由手机房间打开浮动聊天面板");
      assert.equal(ui.controls.scrollTop, 75, "全屏浮层不重置旧controls的滚动位置");
      assert.equal(ui.ids.anonRoom.scrollCalls, undefined, "全屏聊天不得滚动外部页面");
      if (mode === "deepseek") {
        assert.equal(ui.requests.length, 1, "全屏聊天不必等待旧双rAF定位即可请求AI");
        ui.submit("忙碌时不要重复打开");
        assert.equal(prepared, 1, "忙碌时不重复打开浮层");
        await ui.complete("来个 Wink！");
      } else assert.match(ui.lastText(), /Wink/, "本地回复正常完成");
      ui.frame(); ui.frame(); await tick();
      assert.equal(ui.controls.scrollTop, 75, "随后动画帧也不能执行旧滚动逻辑");
      assert.equal(ui.ids.anonChatLog.scrollCalls, undefined, "消息列表不得触发外部scrollIntoView");
      if (mode === "deepseek") assert.equal(ui.lastText(), "来个 Wink！");
      assert.equal(ui.send.disabled, false);
    }
  }

  let prepared = 0;
  const locked = await browserFixture({ mobile: true, accessCodeRequired: true,
    mobileRoom: { prepareChat() { prepared++; return true; } },
  });
  locked.controls.scrollTop = 85;
  const initialMessages = locked.ids.anonChatLog.children.length;
  locked.submit("需要先解锁");
  assert.equal(locked.ids.anonChatAccessDialog.open, true);
  assert.equal(locked.ids.anonChatAccessCode.focused, true);
  assert.equal(prepared, 0, "鉴权弹窗打开时不得调用会收起键盘的浮层hook");
  assert.equal(locked.ids.anonRoom.scrollCalls, undefined);
  assert.equal(locked.controls.scrollTop, 85);
  assert.equal(locked.requests.length, 0);
  assert.equal(locked.ids.anonChatLog.children.length, initialMessages, "未解锁的内容不应加入记录");
  locked.unlock("DWBH"); locked.unlocks[0].resolve();
  await settle(() => !locked.ids.anonChatAccessDialog.open, "正确密码解锁");
  locked.submit("解锁后继续");
  assert.equal(prepared, 1);
  await locked.complete("继续聊吧！");
  assert.equal(locked.lastText(), "继续聊吧！");

  for (const mobile of [true, false]) {
    let declined = 0;
    const ui = await browserFixture({ mobile,
      mobileRoom: { prepareChat() { declined++; return false; } },
    });
    ui.select("local"); ui.submit("你好");
    assert.equal(declined, 1);
    if (mobile) {
      assert.equal(ui.ids.anonRoom.scrollCalls.length, 1, "未接管时保留旧手机定位");
      assert.equal(ui.send.disabled, true);
      ui.frame(); ui.frame();
      await settle(() => !ui.send.disabled, "旧手机流程仍可完成");
    } else {
      assert.equal(ui.ids.anonRoom.scrollCalls, undefined, "桌面布局不增加页面滚动");
      assert.equal(ui.send.disabled, false, "桌面本地回复仍同步完成");
    }
  }
}

(async () => {
  await testParser();
  await testClient();
  await testPasswordLock();
  await testEmotionFeedback();
  await testSegmentPlayback();
  await testActualMotionCompletion();
  await testLongReplyContinuation();
  await testModelAwareContinuation();
  await testReadingAndComposition();
  await testCompactMobileScroll();
  await testMobileOverlayChat();
  console.log("聊天前端验证通过：UTF-8/NDJSON 异步保序、生命周期竞争、历史预算、故障降级、密码鉴权、分段情绪、渐进播放、按真实80%进度续接、取消隔离、上翻阅读、中文输入法防误发送、短屏内部定位与手机浮层接管。");
})().catch((error) => { console.error(error); process.exitCode = 1; });
