"use strict";

// 执行真实 viewer，只替代浏览器平台与渲染库；无需 WebGL、网络或模型 API。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const actions = require("../assets/js/live2d-actions.js");
const source = fs.readFileSync(path.join(__dirname, "../assets/js/live2d-viewer.js"), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
async function settle(check, message) {
  for (let attempt = 0; attempt < 30; attempt++) { if (check()) return; await tick(); }
  assert.ok(check(), message);
}
class Element {
  constructor() {
    this.children = []; this.dataset = {}; this.attributes = {}; this.handlers = {};
    this.clientWidth = 600; this.clientHeight = 700;
    this.classList = { toggle() {} };
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  click() { this.handlers.click?.(); }
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  querySelectorAll() { return this.children; }
  querySelector() { return null; }
}
async function harness(options = {}) {
  const names = ["l2dStage", "l2dCanvas", "l2dStatus", "l2dFallback", "l2dHint", "l2dRetry", "l2dPause", "l2dFollowMouse", "l2dCostumes", "l2dMotions", "l2dExpressions", "l2dExpressionNote", "l2dZoomIn", "l2dZoomOut", "l2dZoomReset", "l2dZoomValue"];
  const elements = Object.fromEntries(names.map((name) => [name, new Element()]));
  const defaults = Object.values(actions.defaults);
  const motions = [...new Set(defaults.map((item) => item.motion))].map((name) => name + ".mtn");
  const expressions = [...new Set(defaults.map((item) => item.expression))];
  if (options.variants) {
    motions.push("smile02.mtn", "smile03.mtn");
    expressions.push("smile02", "smile03", "wink02", "wink03");
  }
  const costumes = ["first", "second"].map((id) => ({ id, modelJson: id, label: id, motions, expressions, motionCount: motions.length, expressionCount: expressions.length }));
  if (options.costume) costumes[0] = { ...options.costume, id: "first", modelJson: "first" };
  for (const slot of [...(options.performance ? [0] : []), ...(options.performanceSecond ? [1] : [])]) Object.assign(costumes[slot], {
    mode: "performance", expressions: [], expressionCount: 0,
    motions: ["mtn_idle_01.motion3.json", "mtn_play01_01.motion3.json", "mtn_play02_01.motion3.json"], motionCount: 3,
    performanceActions: [{ motion: "mtn_idle_01", label: "演奏待机" }, { motion: "mtn_play01_01", label: "吉他演奏 1" }, { motion: "mtn_play02_01", label: "吉他演奏 2" }],
    reactions: Object.fromEntries(Object.keys(actions.defaults).map((emotion) => [emotion, { motion: emotion === "neutral" ? "mtn_idle_01" : emotion === "thinking" ? "mtn_play02_01" : "mtn_play01_01", expression: "" }])),
  });
  const models = [];
  const plays = [];
  const resources = [];
  const modelLoads = [];
  const textures = new Map();
  const pendingModels = new Map();
  const buildModel = (id) => {
    const { motions, expressions } = costumes.find((costume) => costume.id === id);
    const waiting = new Map();
    if (options.warmBarrier) waiting.set("motion:thinking01", options.warmBarrier);
    const expressionObjects = expressions.map((name) => ({ name }));
    const expressionManager = {
      expressions: expressionObjects,
      currentExpression: null,
      getExpressionIndex: (name) => expressions.indexOf(name),
      loadExpression: (index) => { resources.push("expression:" + expressions[index]); return waiting.get("expression:" + expressions[index])?.promise || Promise.resolve(expressionObjects[index]); },
    };
    const manager = {
      expressionManager: expressions.length ? expressionManager : undefined, state: { currentGroup: null, currentIndex: -1 }, finished: false,
      isFinished() { return this.finished; },
      loadMotion: (group, index) => { resources.push("motion:" + actions.stem(motions[index])); return waiting.get("motion:" + actions.stem(motions[index]))?.promise || Promise.resolve({ group, index }); },
    };
    const textureId = options.sharedTextures ? "shared" : id;
    if (!textures.has(textureId) || textures.get(textureId).destroyed) textures.set(textureId, {
      baseTexture: {}, destroyed: false, destroy(baseTexture) { this.destroyed = true; this.baseDestroyed = baseTexture; },
    });
    const model = {
      id, waiting, destroyed: false, scale: { value: 1, set(value) { this.value = value; } },
      textures: [textures.get(textureId)],
      internalModel: { motionManager: manager, focusController: { focus() {} } },
      getLocalBounds: () => ({ x: 0, y: 0, width: 2000, height: 2500 }),
      registerInteraction() {}, unregisterInteraction() {}, update(delta) { if (delta > 0) this.initialized = true; },
      destroy() { this.destroyed = true; },
      motion(group, index) {
        if (manager.state.currentGroup === group && manager.state.currentIndex === index && !manager.finished) return Promise.resolve(false);
        manager.state.currentGroup = group; manager.state.currentIndex = index;
        manager.finished = false;
        plays.push({ id, type: "motion", name: motions[index] }); return Promise.resolve(true);
      },
      expression(name) { plays.push({ id, type: "expression", name }); expressionManager.currentExpression = expressionObjects[expressions.indexOf(name)]; return Promise.resolve(true); },
    };
    models.push(model);
    return model;
  };
  let visibility;
  let intersection;
  let resize;
  let renderCount = 0;
  const document = { hidden: !!options.hidden, getElementById: (id) => elements[id], createElement: () => new Element(), addEventListener: (type, handler) => { if (type === "visibilitychange") visibility = handler; } };
  const window = {
    ANON_LIVE2D: { defaultCostume: "first", costumes }, AnonLive2DActions: actions,
    Live2D: {}, Live2DCubismCore: { Version: { csmGetVersion: () => 83951616 } },
    PIXI: {
      Application: class {
        constructor() { this.ticker = { add() {} }; this.renderer = { resize() {}, plugins: { interaction: {} } }; this.stage = { addChild() {}, removeChild() {} }; }
        start() {} stop() {} render() { renderCount += 1; }
      },
      live2d: { config: {}, MotionPriority: { FORCE: 3 }, MotionPreloadStrategy: { IDLE: "IDLE" }, Live2DModel: { from: async (id) => { modelLoads.push(id); return pendingModels.has(id) ? pendingModels.get(id).promise : buildModel(id); } } },
    },
    navigator: { connection: { saveData: !!options.saveData } },
    addEventListener(type, handler) { if (type === "resize") resize = handler; }, dispatchEvent() {}, matchMedia: () => ({ matches: !!options.paused }),
    IntersectionObserver: class {
      constructor(callback) { intersection = callback; }
      observe() { intersection([{ isIntersecting: options.visible !== false }]); }
    },
  };
  vm.runInNewContext(source, {
    window, document, console, CustomEvent: class {}, IntersectionObserver: window.IntersectionObserver,
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: (callback) => { queueMicrotask(callback); return 1; }, clearTimeout() {},
  }, { filename: "live2d-viewer.js" });
  if (!options.hidden && options.visible !== false) await settle(() => window.AnonLive2D.getState().ready && !window.AnonLive2D.getState().loading, "初始模型应可用");
  await tick();
  plays.length = 0;
  return { viewer: window.AnonLive2D, models, plays, resources, modelLoads, textures, elements, pendingModels, buildModel, document, visibility: () => visibility(), intersect: (visible) => intersection([{ isIntersecting: visible }]), renders: () => renderCount, resize: (width, height) => { elements.l2dStage.clientWidth = width; elements.l2dStage.clientHeight = height; resize(); } };
}
const block = (model, resource) => { const pending = deferred(); model.waiting.set(resource, pending); return pending; };

(async () => {
  {
    const h = await harness({ visible: false });
    assert.deepEqual(h.modelLoads, [], "首屏未进入模型区域时不请求模型");
    h.intersect(true);
    await settle(() => h.viewer.getState().ready, "滚动至模型后才加载");
    assert.deepEqual(h.modelLoads, ["first"]);
  }
  {
    const h = await harness({ hidden: true });
    assert.deepEqual(h.modelLoads, [], "后台页即使命中视口也不请求模型");
    h.document.hidden = false; h.visibility();
    await settle(() => h.viewer.getState().ready, "返回前台后正常初始化");
    assert.deepEqual(h.modelLoads, ["first"]);
  }
  {
    const h = await harness({ paused: true });
    assert.deepEqual(h.resources, [], "减少动态效果默认暂停时不额外预热动作");
    h.elements.l2dPause.click();
    await settle(() => h.resources.includes("motion:smile01"), "主动播放后预热常用动作");
  }
  {
    const h = await harness({ saveData: true });
    assert.ok(h.resources.every((name) => ["motion:idle01", "expression:default"].includes(name)), "省流量时只加载实际请求的默认姿态");
    assert.equal((await h.viewer.react({ emotion: "smile" })).ok, true, "省流量不妨碍主动聊天动作");
  }
  for (const suspension of ["pause", "offscreen", "hidden"]) {
    const barrier = deferred();
    const h = await harness({ warmBarrier: barrier });
    assert.ok(h.resources.includes("motion:thinking01"), "预热已经开始");
    if (suspension === "pause") h.elements.l2dPause.click();
    if (suspension === "offscreen") h.intersect(false);
    if (suspension === "hidden") { h.document.hidden = true; h.visibility(); }
    const before = h.resources.length;
    barrier.resolve({}); await tick();
    assert.equal(h.resources.length, before, `${suspension}后不继续预热下一批资源`);
    if (suspension === "pause") h.elements.l2dPause.click();
    if (suspension === "offscreen") h.intersect(true);
    if (suspension === "hidden") { h.document.hidden = false; h.visibility(); }
    await settle(() => h.resources.includes("motion:smile01"), `${suspension}恢复后接着预热`);
    assert.equal(h.resources.filter((name) => name === "motion:thinking01").length, 1, "恢复沿用进度，不从头下载");
  }
  {
    const h = await harness();
    const old = h.models[0].textures[0];
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "second").click();
    await settle(() => h.viewer.getState().costume === "second", "换装完成");
    assert.equal(old.destroyed, true, "换装后旧纹理必须释放");
    assert.equal(old.baseDestroyed, true, "同时释放 GPU 基础纹理");
    assert.equal(h.models[1].textures[0].destroyed, false, "当前模型纹理仍保留");
  }
  {
    const h = await harness({ sharedTextures: true });
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "second").click();
    await settle(() => h.viewer.getState().costume === "second", "共享纹理换装完成");
    assert.equal(h.models[0].textures[0], h.models[1].textures[0]);
    assert.equal(h.models[1].textures[0].destroyed, false, "不能释放仍由当前模型共用的缓存纹理");
  }
  {
    const h = await harness();
    const second = deferred(); const first = deferred();
    h.pendingModels.set("second", second); h.pendingModels.set("first", first);
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "second").click();
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "first").click();
    const stale = h.buildModel("second"); second.resolve(stale); await tick();
    assert.equal(stale.destroyed, true, "迟到模型不挂载");
    assert.equal(stale.textures[0].destroyed, false, "还有并行换装时暂缓清理共享缓存");
    const latest = h.buildModel("first"); first.resolve(latest);
    await settle(() => !h.viewer.getState().loading, "最后一次换装完成");
    assert.equal(stale.textures[0].destroyed, true, "并行换装结束后清理过期纹理");
    assert.equal(latest.textures[0].destroyed, false, "快速换回同服装不会破坏当前纹理");
  }
  {
    const h = await harness();
    const delayed = block(h.models[0], "motion:shame01");
    const older = h.viewer.react({ emotion: "shy" });
    assert.equal((await h.viewer.react({ emotion: "smile" })).ok, true);
    delayed.resolve({});
    assert.equal((await older).ok, false);
    assert.ok(h.plays.some((event) => event.name === "smile01.mtn"));
    assert.ok(!h.plays.some((event) => event.name.includes("shame")), "迟到的旧动作不能覆盖新情绪");
  }
  {
    const h = await harness();
    const delayed = block(h.models[0], "expression:shame01");
    const controller = new AbortController();
    const older = h.viewer.react({ emotion: "shy", signal: controller.signal });
    controller.abort(); delayed.resolve({});
    assert.equal((await older).ok, false);
    assert.deepEqual(h.plays, [], "取消后预加载完成也不能播放");
  }
  {
    const h = await harness();
    const delayed = block(h.models[0], "motion:shame01");
    const pending = h.viewer.react({ emotion: "shy" });
    h.elements.l2dPause.click(); delayed.resolve({});
    assert.equal((await pending).ok, false);
    assert.deepEqual(h.plays, [], "暂停后迟到资源不能播放");
    h.elements.l2dPause.click();
    await settle(() => h.plays.some((event) => event.name === "shame01.mtn"), "恢复时播放最新期望情绪");
  }
  {
    const h = await harness();
    const delayed = block(h.models[0], "motion:shame01");
    const pending = h.viewer.react({ emotion: "shy" });
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "second").click();
    await settle(() => h.viewer.getState().costume === "second", "换装完成");
    await tick(); delayed.resolve({});
    assert.equal((await pending).ok, false);
    assert.equal(h.models[0].destroyed, true);
    assert.ok(!h.plays.some((event) => event.id === "first"), "被销毁旧模型不能播放迟到动作");
    assert.ok(h.plays.some((event) => event.id === "second" && event.name === "shame01.mtn"), "最新情绪应映射至新模型");
  }
  {
    const h = await harness();
    const delayed = block(h.models[0], "expression:shame01");
    const pending = h.viewer.react({ emotion: "shy" });
    h.intersect(false); delayed.resolve({});
    assert.equal((await pending).ok, false);
    assert.deepEqual(h.plays, [], "离屏时不能开始迟到动作");
    h.intersect(true);
    await settle(() => h.plays.length > 0, "回到视口后恢复最新情绪");
  }
  {
    const h = await harness();
    const delayed = block(h.models[0], "motion:shame01");
    const controller = new AbortController();
    const pending = h.viewer.react({ emotion: "shy", signal: controller.signal });
    controller.abort(); h.document.hidden = true; h.visibility(); delayed.resolve({});
    await pending;
    h.document.hidden = false; h.visibility();
    h.elements.l2dPause.click(); h.elements.l2dPause.click();
    await tick();
    assert.deepEqual(h.plays, [], "恢复页面或动画不能重播已取消请求");
  }
  {
    const h = await harness();
    h.models[0].internalModel.motionManager.expressionManager.loadExpression = async () => undefined;
    const result = await h.viewer.react({ emotion: "shy" });
    assert.equal(result.ok, false, "预加载资源缺失时应明确失败");
    assert.deepEqual(h.plays, [], "预加载失败不能进入库的播放/重试路径，以免迟到重试越过取消检查");
  }
  {
    const h = await harness();
    assert.equal((await h.viewer.react({ emotion: "smile" })).ok, true);
    const before = h.plays.length;
    assert.equal((await h.viewer.react({ emotion: "smile" })).ok, true, "同动作已在播放时不应误报失败");
    assert.equal(h.plays.length, before, "当前动作与表情不应被重复启动");
  }
  {
    const h = await harness();
    const model = h.models[0];
    const baseScale = model.scale.value;
    const baseTop = model.y;
    h.elements.l2dZoomIn.click();
    assert.equal(h.viewer.getState().zoomPercent, 110);
    assert.equal(h.elements.l2dZoomValue.textContent, "110%");
    assert.ok(Math.abs(model.scale.value - baseScale * 1.1) < 1e-9);
    assert.ok(Math.abs(model.y - baseTop) < 1e-9, "放大保留顶部，头部不会被推出画面");
    assert.ok(Math.abs(model.x + 1000 * model.scale.value - 300) < 1e-9, "缩放保持横向居中");
    for (let n = 0; n < 20; n++) h.elements.l2dZoomIn.click();
    assert.equal(h.viewer.getState().zoomPercent, 180);
    assert.equal(h.elements.l2dZoomIn.disabled, true);
    for (let n = 0; n < 20; n++) h.elements.l2dZoomOut.click();
    assert.equal(h.viewer.getState().zoomPercent, 50);
    assert.equal(h.elements.l2dZoomOut.disabled, true);
    h.elements.l2dZoomReset.click();
    assert.equal(model.scale.value, baseScale);
    assert.equal(h.elements.l2dZoomReset.disabled, true);
  }
  {
    const h = await harness();
    h.elements.l2dPause.click();
    const before = h.renders();
    h.elements.l2dZoomIn.click(); h.elements.l2dZoomIn.click();
    assert.equal(h.viewer.getState().paused, true);
    assert.ok(h.renders() > before, "暂停动画时缩放仍立即重绘");
    h.resize(320, 230);
    assert.equal(h.viewer.getState().zoomPercent, 120);
    assert.ok(Math.abs(h.models[0].scale.value - Math.min(320 * .86 / 2000, 230 * .9 / 2500) * 1.2) < 1e-9);
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "second").click();
    await settle(() => h.viewer.getState().costume === "second", "换装完成");
    assert.equal(h.viewer.getState().zoomPercent, 120);
    assert.equal(h.elements.l2dZoomValue.textContent, "120%");
    assert.equal(h.models[1].scale.value, h.models[0].scale.value, "同尺寸新模型保留相对比例");
    assert.equal(h.models[1].initialized, true, "暂停换装仍需产生首帧顶点，不能只发零增量更新");
  }
  {
    const h = await harness({ performance: true });
    assert.equal(h.elements.l2dExpressionNote.hidden, false);
    assert.equal(h.elements.l2dExpressions.children.length, 0, "无表情模型不生成虚假的表情按钮");
    assert.deepEqual(h.elements.l2dMotions.children.map((button) => button.textContent), ["演奏待机", "吉他演奏 1", "吉他演奏 2"]);
    const result = await h.viewer.react({ emotion: "smile" });
    assert.equal(result.ok, true, "空表情、无expressionManager的演奏模型仍能响应");
    assert.equal(result.expression, "");
    assert.equal(result.mode, "performance");
    assert.equal(result.motion, "mtn_play01_01");
    assert.equal(result.actionLabel, "吉他演奏 1");
    h.elements.l2dMotions.children[2].click();
    await settle(() => h.plays.some((event) => event.name === "mtn_play02_01.motion3.json"), "可以手选真实舞台演奏动作");
    assert.ok(h.plays.every((event) => event.type === "motion"), "不尝试播放不存在的表情");
    assert.match(h.elements.l2dHint.textContent, /已播放「吉他演奏 2」动作/);
  }
  {
    const h = await harness({ performance: true });
    assert.match(h.elements.l2dHint.textContent, /聊天会自动触发此款真实舞台动作/);
    await h.viewer.react({ emotion: "smile" });
    const before = h.plays.length;
    assert.equal((await h.viewer.react({ emotion: "smile" })).ok, true);
    assert.equal(h.plays.length, before, "仍在播放的相同动作不反复重启");
    h.models[0].internalModel.motionManager.finished = true;
    assert.equal((await h.viewer.react({ emotion: "smile" })).ok, true);
    assert.equal(h.plays.length, before + 1, "同一动作结束后可以再次响应聊天");
    const idle = await h.viewer.react({ emotion: "neutral" });
    assert.equal(idle.actionLabel, "演奏待机");
    assert.equal(idle.motion, "mtn_idle_01");
  }
  {
    const h = await harness({ performanceSecond: true });
    const loading = deferred(); h.pendingModels.set("second", loading);
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "second").click();
    assert.equal((await h.viewer.react({ emotion: "smile" })).ok, false);
    assert.equal((await h.viewer.react({ emotion: "thinking" })).ok, false);
    const target = h.buildModel("second"); loading.resolve(target);
    await settle(() => h.plays.some((event) => event.id === "second"), "换装后自动播放最新回应");
    assert.deepEqual(h.plays.filter((event) => event.id === "second").map((event) => event.name), ["mtn_play02_01.motion3.json"]);
  }
  {
    const h = await harness({ performanceSecond: true });
    const loading = deferred(); h.pendingModels.set("second", loading);
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "second").click();
    const controller = new AbortController();
    await h.viewer.react({ emotion: "smile", signal: controller.signal });
    controller.abort(); h.elements.l2dPause.click();
    loading.resolve(h.buildModel("second"));
    await settle(() => h.viewer.getState().costume === "second", "已取消请求期间换装仍完成");
    await tick();
    assert.ok(!h.plays.some((event) => event.id === "second"), "取消或暂停后不能启动排队舞台动作");
    h.elements.l2dPause.click(); await tick();
    assert.ok(!h.plays.some((event) => event.id === "second"), "恢复不能复活已取消的排队请求");
  }
  {
    const h = await harness({ variants: true });
    const first = await h.viewer.react({ emotion: "smile", source: "chat" });
    const second = await h.viewer.react({ emotion: "smile", source: "chat" });
    assert.equal(first.motion, "smile01"); assert.equal(first.expression, "smile01");
    assert.equal(second.motion, "smile02"); assert.equal(second.expression, "smile02");
    h.elements.l2dPause.click(); h.elements.l2dPause.click(); await tick();
    assert.equal(h.plays.at(-1).name, "smile02", "恢复保持此前选中表情");
    const third = await h.viewer.react({ emotion: "smile", source: "chat" });
    assert.equal(third.motion, "smile03", "恢复不消耗下一候选");
    assert.equal(third.expression, "smile03");
    const manual = await h.viewer.react({ motion: "smile01" });
    assert.equal(manual.motion, "smile01"); assert.equal(manual.expression, "smile01", "手动指定动作仍精确按默认配对");
    const idle = await h.viewer.react({ emotion: "neutral", source: "control" });
    assert.equal(idle.motion, "idle01"); assert.equal(idle.expression, "default");
    const wink1 = await h.viewer.react({ emotion: "wink", source: "chat" });
    const wink2 = await h.viewer.react({ emotion: "wink", source: "chat" });
    assert.equal(wink1.motion, wink2.motion, "单一动作候选保持真实动作");
    assert.notEqual(wink1.expression, wink2.expression, "单一动作仍轮换同语气表情");
  }
  {
    const h = await harness({ variants: true });
    const first = await h.viewer.react({ emotion: "smile", source: "chat" });
    const before = h.plays.length;
    const hold = await h.viewer.react({ emotion: "smile", source: "chat", continuation: true });
    assert.equal(hold.motion, first.motion); assert.equal(hold.expression, first.expression);
    assert.equal(h.plays.length, before, "续接不截断仍在播放的动作或换表情");
    const manager = h.models[0].internalModel.motionManager;
    manager.finished = true;
    const next = await h.viewer.react({ emotion: "smile", source: "chat", continuation: true });
    assert.equal(next.motion, "smile02"); assert.equal(next.expression, "smile02");
    manager.state.currentGroup = "idle"; manager.state.currentIndex = 0;
    const afterIdle = await h.viewer.react({ emotion: "smile", source: "chat", continuation: true });
    assert.equal(afterIdle.motion, "smile03", "动作自动回idle后续接取下一候选");
  }
  {
    const h = await harness({ variants: true });
    await h.viewer.react({ emotion: "smile", source: "chat" });
    const cancelled = block(h.models[0], "motion:smile02");
    const controller = new AbortController();
    const pending = h.viewer.react({ emotion: "smile", source: "chat", signal: controller.signal });
    controller.abort(); cancelled.resolve({});
    assert.equal((await pending).ok, false);
    assert.equal((await h.viewer.react({ emotion: "smile", source: "chat" })).motion, "smile02", "取消不推进轮换");
    const failed = block(h.models[0], "motion:smile03");
    const failedRequest = h.viewer.react({ emotion: "smile", source: "chat" });
    failed.resolve(undefined);
    assert.equal((await failedRequest).ok, false);
    h.models[0].waiting.delete("motion:smile03");
    assert.equal((await h.viewer.react({ emotion: "smile", source: "chat" })).motion, "smile03", "资源加载失败不推进轮换");
  }
  {
    const h = await harness({ variants: true });
    await h.viewer.react({ emotion: "smile", source: "chat" });
    const delayed = block(h.models[0], "motion:smile02");
    const older = h.viewer.react({ emotion: "smile", source: "chat" });
    const newer = h.viewer.react({ emotion: "smile", source: "chat" });
    delayed.resolve({});
    assert.equal((await older).ok, false);
    assert.equal((await newer).motion, "smile02");
    assert.equal((await h.viewer.react({ emotion: "smile", source: "chat" })).motion, "smile03", "迟到旧请求只让最新成功请求推进一次");
    h.elements.l2dPause.click();
    assert.equal((await h.viewer.react({ emotion: "smile", source: "chat" })).ok, false);
    h.elements.l2dPause.click(); await tick();
    const current = h.models[0].internalModel.motionManager;
    assert.equal(current.state.currentIndex, 1, "暂停时请求在恢复后才选择下一个smile01");
    assert.equal((await h.viewer.react({ emotion: "smile", source: "chat" })).motion, "smile02");
  }
  {
    const h = await harness({ variants: true });
    await h.viewer.react({ emotion: "smile", source: "chat" });
    await h.viewer.react({ emotion: "smile", source: "chat" });
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "second").click();
    await settle(() => h.plays.some((event) => event.id === "second"), "换装后重放此前选择");
    assert.ok(h.plays.some((event) => event.id === "second" && event.name === "smile02.mtn"), "相容模型换装后保持同一动作变体");
    assert.equal((await h.viewer.react({ emotion: "smile", source: "chat" })).motion, "smile03", "换装重放不会额外消耗候选");
  }
  {
    const data = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assets/data/anon-live2d.js"), "utf8"), { window: data });
    assert.equal(data.ANON_LIVE2D.costumes.length, 12);
    for (const costume of data.ANON_LIVE2D.costumes) {
      const h = await harness({ costume });
      for (const emotion of Object.keys(actions.defaults)) {
        const candidates = actions.variants(costume, { emotion });
        const expected = candidates.map((choice) => `${choice.motion}|${choice.expression}`).sort();
        assert.ok(expected.length, `${costume.id}/${emotion}应有真实候选`);
        for (let cycle = 0; cycle < 3; cycle++) {
          const actual = [];
          for (let index = 0; index < candidates.length; index++) {
            h.models[0].internalModel.motionManager.finished = true;
            const result = await h.viewer.react({ emotion, source: "chat" });
            assert.equal(result.ok, true);
            actual.push(`${result.motion}|${result.expression}`);
            if (index === 0 && emotion !== "neutral") {
              const held = await h.viewer.react({ emotion, source: "chat", continuation: true });
              assert.equal(`${held.motion}|${held.expression}`, actual[0], "保留当前动作的续接不消费候选");
              h.elements.l2dPause.click(); h.elements.l2dPause.click(); await tick();
            }
          }
          assert.deepEqual(actual.sort(), expected, `${costume.id}/${emotion}第${cycle + 1}轮必须覆盖全部候选，恢复和续接不消费名额`);
        }
      }
    }
  }
  console.log("Live2D viewer 验证通过：29组加载/资源释放/播放/缩放/轮换回归，另验证真实12款×13语气×连续3轮全候选覆盖，共30组。");
})().catch((error) => { console.error(error); process.exitCode = 1; });
