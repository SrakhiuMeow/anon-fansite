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
  let resolve; let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
async function settle(check, message) {
  for (let attempt = 0; attempt < 30; attempt++) { if (check()) return; await tick(); }
  assert.ok(check(), message);
}
class Element {
  constructor() {
    this.children = []; this.dataset = {}; this.attributes = {}; this.handlers = {};
    this.clientWidth = 600; this.clientHeight = 700;
    const classes = new Set();
    this.classList = { contains: (name) => classes.has(name), add: (name) => classes.add(name), remove: (name) => classes.delete(name), toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } };
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
  const names = ["anonRoom", "l2dStage", "l2dCanvas", "l2dStatus", "l2dFallback", "l2dHint", "l2dRetry", "l2dPause", "l2dFollowMouse", "l2dCostumes", "l2dMotions", "l2dExpressions", "l2dExpressionNote", "l2dZoomIn", "l2dZoomOut", "l2dZoomReset", "l2dZoomValue"];
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
  if (options.bdonFirst) costumes[0].source = "https://bdon.moe";
  if (options.bdonSecond) costumes[1].source = "https://bdon.moe";
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
  class Cubism2ExpressionManager {
    createExpression(definition) { return { definition }; }
  }
  const buildModel = (id) => {
    const { motions, expressions } = costumes.find((costume) => costume.id === id);
    const waiting = new Map();
    if (options.warmBarrier) waiting.set("motion:thinking01", options.warmBarrier);
    const expressionObjects = expressions.map((name) => options.cubism2Expressions
      ? Object.assign(new Cubism2ExpressionManager().createExpression({ fade_in: 750, fade_out: 1100 }), { name }) : ({ name,
      getFadeInTime: () => options.expressionFadeIn ?? 0.5,
      getFadeOutTime: () => options.expressionFadeOut ?? 0.5,
    }));
    const expressionManager = {
      expressions: expressionObjects,
      currentExpression: null,
      getExpressionIndex: (name) => expressions.indexOf(name),
      loadExpression: (index) => { resources.push("expression:" + expressions[index]); return waiting.get("expression:" + expressions[index])?.promise || Promise.resolve(expressionObjects[index]); },
    };
    const managerEvents = new Map();
    const manager = {
      expressionManager: expressions.length ? expressionManager : undefined, state: { currentGroup: null, currentIndex: -1 }, finished: false,
      on(name, callback) { managerEvents.set(name, callback); },
      emit(name) { managerEvents.get(name)?.(); },
      isFinished() { return this.finished; },
      loadMotion: (group, index) => { resources.push("motion:" + actions.stem(motions[index])); return waiting.get("motion:" + actions.stem(motions[index]))?.promise || Promise.resolve({ group, index }); },
    };
    const textureId = options.sharedTextures ? "shared" : id;
    if (!textures.has(textureId) || textures.get(textureId).destroyed) textures.set(textureId, {
      baseTexture: {}, destroyed: false, destroy(baseTexture) { this.destroyed = true; this.baseDestroyed = baseTexture; },
    });
    const model = {
      id, waiting, destroyed: false, elapsedTime: 0, deltaTime: 0, scale: { value: 1, set(value) { this.value = value; } },
      textures: [textures.get(textureId)],
      internalModel: { motionManager: manager, focusController: { focus() {} },
        handlers: {}, on(name, handler) { this.handlers[name] = handler; }, emit(name) { this.handlers[name]?.(); },
      },
      getLocalBounds: () => ({ x: 0, y: 0, width: 2000, height: 2500 }),
      registerInteraction() {}, unregisterInteraction() {}, update(delta) {
        this.deltaTime += delta; this.elapsedTime += delta;
      },
      renderFrame() {
        if (!this.deltaTime) return;
        this.initialized = true;
        if (manager.finished && manager.playing) {
          manager.playing = false; manager.emit("motionFinish");
          manager.state.currentGroup = undefined; manager.state.currentIndex = undefined;
        }
        this.internalModel.emit("beforeModelUpdate");
        this.deltaTime = 0;
      },
      destroy() { this.destroyed = true; },
      motion(group, index) {
        if (manager.state.currentGroup === group && manager.state.currentIndex === index && !manager.finished) return Promise.resolve(false);
        manager.state.currentGroup = group; manager.state.currentIndex = index;
        manager.finished = false;
        manager.playing = true;
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
  let advance;
  let application;
  const media = { matches: !!options.mobile, addEventListener(type, callback) { this.changed = callback; } };
  let renderCount = 0;
  const document = { hidden: !!options.hidden, getElementById: (id) => elements[id], createElement: () => new Element(), addEventListener: (type, handler) => { if (type === "visibilitychange") visibility = handler; } };
  const window = {
    ANON_LIVE2D: { defaultCostume: "first", costumes }, AnonLive2DActions: actions,
    Live2D: {}, Live2DCubismCore: { Version: { csmGetVersion: () => 83951616 } },
    PIXI: {
      Application: class {
        constructor() {
          application = this;
          this.ticker = { deltaMS: 16, add(callback) { advance = (milliseconds = 16, render = true) => { this.deltaMS = milliseconds; callback(); if (render) application.render(); }; } };
          this.renderer = { resize() {}, plugins: { interaction: {} } };
          this.stage = { current: null, addChild(model) { this.current = model; }, removeChild(model) { if (this.current === model) this.current = null; } };
        }
        start() {} stop() {} render() { renderCount += 1; this.stage.current?.renderFrame(); }
      },
      live2d: { config: { expressionFadingDuration: 500 }, Cubism2ExpressionManager, MotionPriority: { FORCE: 3 }, MotionPreloadStrategy: { IDLE: "IDLE" }, Live2DModel: { from: async (id) => { modelLoads.push(id); return pendingModels.has(id) ? pendingModels.get(id).promise : buildModel(id); } } },
    },
    navigator: { connection: { saveData: !!options.saveData } },
    addEventListener(type, handler) { if (type === "resize") resize = handler; }, dispatchEvent() {}, matchMedia: (query) => query.includes("max-width") ? media : ({ matches: !!options.paused }),
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
  return { viewer: window.AnonLive2D, models, plays, resources, modelLoads, textures, elements, pendingModels, buildModel, document, advance: (milliseconds, render) => advance(milliseconds, render), render: () => application.render(), mobile: (matches) => { media.matches = matches; media.changed?.(); }, visibility: () => visibility(), intersect: (visible) => intersection([{ isIntersecting: visible }]), renders: () => renderCount, resize: (width, height) => { elements.l2dStage.clientWidth = width; elements.l2dStage.clientHeight = height; resize(); } };
}
const block = (model, resource) => { const pending = deferred(); model.waiting.set(resource, pending); return pending; };

(async () => {
  let costumeTotal = 0;
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
    assert.equal(h.viewer.getState().zoomPercent, 100);
    assert.equal(h.elements.l2dZoomValue.textContent, "100%");
    assert.ok(Math.abs(h.models[1].scale.value * 1.2 - h.models[0].scale.value) < 1e-9, "切换到另一款 Bestdori 模型恢复默认比例");
    assert.equal(h.models[1].initialized, true, "暂停换装仍需产生首帧顶点，不能只发零增量更新");
  }
  {
    const h = await harness({ bdonSecond: true });
    const model = h.models[0];
    h.resize(390, 844);
    const desktop = { scale: model.scale.value, x: model.x, y: model.y };
    h.elements.anonRoom.classList.add("mobile-room");
    h.resize(390, 844);
    assert.equal(model.scale.value, desktop.scale, "手机构图不改变100%的缩放含义");
    assert.equal(model.x, desktop.x, "手机仍水平居中");
    assert.ok(model.y < desktop.y, "手机人物上移，为下方浮层留出脸部空间");
    const phoneTop = model.y;
    h.elements.l2dZoomIn.click();
    assert.equal(model.y, phoneTop, "手机手动放大保持顶部锚点");
    h.elements.l2dZoomReset.click();
    h.elements.anonRoom.classList.remove("mobile-room");
    h.resize(390, 844);
    assert.deepEqual({ scale: model.scale.value, x: model.x, y: model.y }, desktop, "离开手机布局完整还原桌面构图");
    h.elements.anonRoom.classList.add("mobile-room");
    h.resize(320, 568);
    const currentTop = model.y;
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "second").click();
    await settle(() => h.viewer.getState().costume === "second", "手机切换bdon模型");
    assert.equal(h.viewer.getState().zoomPercent, 180);
    assert.equal(h.models[1].y, currentTop, "bdon180%采用相同手机顶部锚点");
  }
  {
    const h = await harness({ bdonSecond: true });
    h.elements.l2dZoomIn.click(); h.elements.l2dZoomIn.click();
    const top = h.models[0].y;
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "second").click();
    await settle(() => h.viewer.getState().costume === "second", "切换到 bdon 模型");
    assert.equal(h.viewer.getState().zoomPercent, 180);
    assert.equal(h.elements.l2dZoomValue.textContent, "180%");
    assert.equal(h.elements.l2dZoomIn.disabled, true);
    assert.equal(h.elements.l2dZoomReset.disabled, true);
    assert.match(h.elements.l2dZoomReset.attributes["aria-label"], /180%/);
    assert.match(h.elements.l2dZoomReset.title, /180%/);
    assert.equal(h.models[1].y, top, "180% 延续顶部锚点，不从底部放大裁头");
    h.elements.l2dZoomOut.click();
    assert.equal(h.viewer.getState().zoomPercent, 170);
    assert.equal(h.elements.l2dZoomReset.disabled, false);
    h.elements.l2dZoomReset.click();
    assert.equal(h.viewer.getState().zoomPercent, 180, "bdon 还原按钮回来源默认比例");
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "first").click();
    await settle(() => h.viewer.getState().costume === "first", "回到 Bestdori 模型");
    assert.equal(h.viewer.getState().zoomPercent, 100);
    assert.match(h.elements.l2dZoomReset.attributes["aria-label"], /100%/);
  }
  {
    const h = await harness({ bdonFirst: true, performance: true });
    assert.equal(h.viewer.getState().zoomPercent, 180, "初始演奏模型采用 bdon 默认180%");
    h.elements.l2dZoomOut.click(); h.elements.l2dZoomOut.click();
    h.elements.l2dPause.click(); h.elements.l2dPause.click();
    h.resize(320, 230);
    assert.equal(h.viewer.getState().zoomPercent, 160, "暂停恢复及窗口变化保留手动比例");
    h.elements.l2dZoomReset.click();
    assert.equal(h.viewer.getState().zoomPercent, 180);
  }
  {
    const h = await harness({ bdonSecond: true });
    h.elements.l2dZoomIn.click(); h.elements.l2dZoomIn.click();
    const loading = deferred(); h.pendingModels.set("second", loading);
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "second").click();
    assert.equal(h.viewer.getState().zoomPercent, 120, "加载中不提前更改当前模型比例");
    loading.reject(new Error("模拟模型文件加载失败"));
    await settle(() => !h.viewer.getState().loading, "失败后保留当前服装");
    assert.equal(h.viewer.getState().costume, "first");
    assert.equal(h.viewer.getState().zoomPercent, 120, "加载失败保留当前比例");
    assert.match(h.elements.l2dZoomReset.attributes["aria-label"], /100%/);
  }
  {
    const h = await harness({ bdonSecond: true });
    h.elements.l2dZoomIn.click(); h.elements.l2dZoomIn.click();
    const second = deferred(); const first = deferred();
    h.pendingModels.set("second", second); h.pendingModels.set("first", first);
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "second").click();
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "first").click();
    first.resolve(h.buildModel("first"));
    await settle(() => !h.viewer.getState().loading, "同模型重新挂载完成");
    assert.equal(h.viewer.getState().zoomPercent, 120, "同模型重载保留手动比例");
    second.resolve(h.buildModel("second")); await tick();
    assert.equal(h.viewer.getState().costume, "first");
    assert.equal(h.viewer.getState().zoomPercent, 120, "迟到的 bdon 模型不能将当前比例改为180%");
  }
  for (const bdonFirst of [false, true]) {
    const h = await harness({ mobile: true, bdonFirst, bdonSecond: !bdonFirst });
    assert.equal(h.viewer.getState().zoomPercent, 180, "手机首次打开所有来源均为180%");
    h.elements.l2dZoomOut.click(); h.elements.l2dZoomOut.click();
    assert.equal(h.viewer.getState().zoomPercent, 160);
    const loading = deferred(); h.pendingModels.set("second", loading);
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "second").click();
    h.elements.l2dZoomOut.click();
    loading.resolve(h.buildModel("second"));
    await settle(() => h.viewer.getState().costume === "second", "手机跨来源换装完成");
    assert.equal(h.viewer.getState().zoomPercent, 150, "加载期间最新调节沿用到新模型");
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "first").click();
    await settle(() => h.viewer.getState().costume === "first", "手机换回原模型");
    assert.equal(h.viewer.getState().zoomPercent, 150, "手机只有最近一次比例，不按每套服装备份");
    h.mobile(false);
    assert.equal(h.viewer.getState().zoomPercent, bdonFirst ? 180 : 100, "返回桌面采用桌面保存的来源默认");
    h.elements.l2dZoomOut.click();
    const desktopPercent = h.viewer.getState().zoomPercent;
    h.mobile(true);
    assert.equal(h.viewer.getState().zoomPercent, 150, "再次进入手机仍保留手机最近比例");
    h.elements.l2dZoomReset.click();
    assert.equal(h.viewer.getState().zoomPercent, 180, "手机还原统一为180%");
    h.mobile(false);
    assert.equal(h.viewer.getState().zoomPercent, desktopPercent, "手机调节和还原不会污染桌面手动比例");
  }
  {
    const h = await harness({ mobile: true, bdonSecond: true });
    h.elements.l2dZoomOut.click();
    const second = deferred(); const first = deferred();
    h.pendingModels.set("second", second); h.pendingModels.set("first", first);
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "second").click();
    h.elements.l2dCostumes.children.find((button) => button.dataset.value === "first").click();
    h.elements.l2dZoomOut.click();
    first.resolve(h.buildModel("first"));
    await settle(() => !h.viewer.getState().loading, "手机同款重新挂载完成");
    second.resolve(h.buildModel("second")); await tick();
    assert.equal(h.viewer.getState().zoomPercent, 160, "手机快速切换与迟到结果不覆盖最近缩放");
  }
  {
    const h = await harness({ variants: true });
    await h.viewer.react({ emotion: "smile", source: "chat" });
    let complete = false;
    const next = h.viewer.whenReactionComplete().then(async (ready) => {
      complete = ready;
      return h.viewer.react({ emotion: "angry", source: "chat" });
    });
    h.advance(700); await tick();
    assert.equal(complete, false, "经过700ms也不能把动作启动误作动作完成");
    assert.ok(!h.plays.some((play) => play.name === "angry01.mtn"), "上一段未结束不得切入下一段动作");
    h.advance(9000); await tick();
    assert.equal(complete, false, "等待真实完成，不能用固定播放时长截断长动作");
    h.models[0].internalModel.motionManager.finished = true;
    let finalFrameComplete = false;
    h.viewer.whenReactionComplete().then(() => { finalFrameComplete = true; });
    await tick();
    assert.equal(finalFrameComplete, false, "最后一帧队列结束仍要等管理器清理当前动作，防止同动作续接被拒绝");
    h.advance(16);
    assert.equal((await next).ok, true);
    assert.equal(complete, true);
    assert.ok(h.plays.some((play) => play.name === "angry01.mtn"));
  }
  {
    const h = await harness({ expressionFadeIn: 0.2, expressionFadeOut: 1 });
    await h.viewer.react({ expression: "thinking01", source: "chat" });
    assert.ok(!h.plays.some((play) => play.type === "motion"), "思考准备只切表情，不启动长动作");
    let complete = false;
    const gate = h.viewer.whenReactionComplete().then((ready) => { complete = ready; });
    h.advance(1);
    h.advance(200); await tick();
    assert.equal(complete, false, "新表情淡入结束还需等待旧表情的淡出");
    h.advance(800); await gate;
    assert.equal(complete, true, "表情完成按有限过渡时长，不等持续表情的队列结束");
    await h.viewer.react({ emotion: "smile", source: "chat" });
    const motionGate = h.viewer.whenReactionComplete();
    h.advance(1);
    h.advance(1000);
    const manager = h.models[0].internalModel.motionManager;
    manager.emit("motionFinish");
    assert.equal(await motionGate, true, "两代库共同的 motionFinish 事件能解除动作等待");
  }
  {
    const h = await harness({ cubism2Expressions: true });
    await h.viewer.react({ expression: "thinking01", source: "chat" });
    let complete = false;
    const gate = h.viewer.whenReactionComplete().then((ready) => { complete = ready; });
    h.advance(1);
    h.advance(750); await tick();
    assert.equal(complete, false, "Cubism2 从真实创建参数读取淡入和淡出，不假定统一500ms");
    h.advance(350); await gate;
    assert.equal(complete, true);
    await h.viewer.react({ emotion: "neutral" });
    const idleGate = h.viewer.whenReactionComplete();
    h.advance(1);
    h.advance(1100);
    assert.equal(await idleGate, true, "持续 idle 只等表情过渡，不永久阻塞聊天");
  }
  {
    const h = await harness();
    await h.viewer.react({ expression: "thinking01", source: "chat" });
    let complete = false;
    const gate = h.viewer.whenReactionComplete().then((ready) => { complete = ready; });
    h.advance(1000, false); await tick();
    assert.equal(complete, false, "ticker只累积delta、尚未实际render时不能消耗表情过渡");
    h.render(); await tick();
    assert.equal(complete, false, "首次render才建立表情fade起点，不能提前扣首帧delta");
    h.advance(499); await tick();
    assert.equal(complete, false);
    h.advance(1, false); await tick();
    assert.equal(complete, false, "最后一毫秒尚未渲染也不能先放行下一段");
    h.render(); await gate;
    assert.equal(complete, true, "仅在原生本帧完成表情求值后释放门控");
    await h.viewer.react({ expression: "smile01", source: "chat" });
    h.advance(1); h.advance(250);
    await h.viewer.react({ expression: "smile01", source: "chat" });
    const repeated = h.viewer.whenReactionComplete();
    h.advance(250);
    assert.equal(await repeated, true, "重复同表情沿用已有fade进度与渲染时间，不重设首帧");
  }
  {
    const h = await harness();
    await h.viewer.react({ emotion: "smile", source: "chat" });
    const gate = h.viewer.whenReactionComplete();
    h.advance(1);
    h.advance(1000);
    const manager = h.models[0].internalModel.motionManager;
    manager.state.currentGroup = "idle"; manager.state.currentIndex = 0;
    h.advance(16);
    assert.equal(await gate, true, "自动回到 idle 也说明上一动作已完成");
  }
  for (const interruption of ["abort", "pause", "offscreen", "hidden", "costume", "manual"]) {
    const h = await harness();
    const controller = new AbortController();
    await h.viewer.react({ emotion: "smile", source: "chat", signal: controller.signal });
    const gate = h.viewer.whenReactionComplete(controller.signal);
    if (interruption === "abort") controller.abort();
    if (interruption === "pause") h.elements.l2dPause.click();
    if (interruption === "offscreen") h.intersect(false);
    if (interruption === "hidden") { h.document.hidden = true; h.visibility(); }
    if (interruption === "costume") h.elements.l2dCostumes.children.find((button) => button.dataset.value === "second").click();
    if (interruption === "manual") await h.viewer.react({ expression: "angry01" });
    assert.equal(await gate, false, `${interruption}无需新渲染帧即可释放等待，不把聊天挂死`);
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
    costumeTotal = data.ANON_LIVE2D.costumes.length;
    // 数量随 Bestdori / Our Notes 的上游服装增加，只保证覆盖全部清单。
    assert.ok(data.ANON_LIVE2D.costumes.length >= 12, "清单应包含全部已收录服装");
    const bestdoriCostumes = data.ANON_LIVE2D.costumes.filter((costume) => costume.source === "https://bestdori.com");
    const cardCostumes = bestdoriCostumes.filter((costume) => costume.kind === "card");
    assert.ok(cardCostumes.length >= 14, "应包含 Bestdori 全部卡面服装");
    for (const costume of cardCostumes) {
      assert.ok(costume.cardTitle && costume.costumeId && costume.appliedAt, `${costume.id} 缺少卡面服装元数据`);
    }
    for (const costume of data.ANON_LIVE2D.costumes) {
      const h = await harness({ costume });
      assert.equal(h.viewer.getState().zoomPercent, costume.source === "https://bdon.moe" ? 180 : 100, `${costume.id}初始加载采用来源默认比例`);
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
  console.log(`Live2D viewer 验证通过：加载/资源释放/真实动作结束与两代表情过渡门控/取消与离屏释放/手机180%及跨模型缩放记忆/桌面还原；另验证真实${costumeTotal}套模型的默认比例、卡面服装元数据及13语气×连续3轮全候选覆盖。`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
