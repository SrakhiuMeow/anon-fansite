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
  const costumes = ["first", "second"].map((id) => ({ id, modelJson: id, label: id, motions, expressions, motionCount: motions.length, expressionCount: expressions.length }));
  if (options.performance) Object.assign(costumes[0], {
    mode: "performance", expressions: [], expressionCount: 0,
    motions: ["mtn_idle_01.motion3.json", "mtn_play01_01.motion3.json"], motionCount: 2,
    performanceActions: [{ motion: "mtn_idle_01", label: "演奏待机" }, { motion: "mtn_play01_01", label: "吉他演奏 1" }],
    reactions: Object.fromEntries(Object.keys(actions.defaults).map((emotion) => [emotion, { motion: "mtn_idle_01", expression: "" }])),
  });
  const models = [];
  const plays = [];
  const pendingModels = new Map();
  const buildModel = (id) => {
    const { motions, expressions } = costumes.find((costume) => costume.id === id);
    const waiting = new Map();
    const expressionObjects = expressions.map((name) => ({ name }));
    const expressionManager = {
      expressions: expressionObjects,
      currentExpression: null,
      getExpressionIndex: (name) => expressions.indexOf(name),
      loadExpression: (index) => waiting.get("expression:" + expressions[index])?.promise || Promise.resolve(expressionObjects[index]),
    };
    const manager = {
      expressionManager: expressions.length ? expressionManager : undefined, state: { currentGroup: null, currentIndex: -1 }, isFinished: () => false,
      loadMotion: (group, index) => waiting.get("motion:" + motions[index].replace(".mtn", ""))?.promise || Promise.resolve({ group, index }),
    };
    const model = {
      id, waiting, destroyed: false, scale: { value: 1, set(value) { this.value = value; } },
      internalModel: { motionManager: manager, focusController: { focus() {} } },
      getLocalBounds: () => ({ x: 0, y: 0, width: 2000, height: 2500 }),
      registerInteraction() {}, unregisterInteraction() {}, update(delta) { if (delta > 0) this.initialized = true; },
      destroy() { this.destroyed = true; },
      motion(group, index) {
        if (manager.state.currentGroup === group && manager.state.currentIndex === index) return Promise.resolve(false);
        manager.state.currentGroup = group; manager.state.currentIndex = index;
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
  const document = { hidden: false, getElementById: (id) => elements[id], createElement: () => new Element(), addEventListener: (type, handler) => { if (type === "visibilitychange") visibility = handler; } };
  const window = {
    ANON_LIVE2D: { defaultCostume: "first", costumes }, AnonLive2DActions: actions,
    Live2D: {}, Live2DCubismCore: { Version: { csmGetVersion: () => 83951616 } },
    PIXI: {
      Application: class {
        constructor() { this.ticker = { add() {} }; this.renderer = { resize() {}, plugins: { interaction: {} } }; this.stage = { addChild() {}, removeChild() {} }; }
        start() {} stop() {} render() { renderCount += 1; }
      },
      live2d: { config: {}, MotionPriority: { FORCE: 3 }, MotionPreloadStrategy: { IDLE: "IDLE" }, Live2DModel: { from: async (id) => pendingModels.has(id) ? pendingModels.get(id).promise : buildModel(id) } },
    },
    addEventListener(type, handler) { if (type === "resize") resize = handler; }, dispatchEvent() {}, matchMedia: () => ({ matches: false }),
    IntersectionObserver: class {
      constructor(callback) { intersection = callback; }
      observe() { intersection([{ isIntersecting: true }]); }
    },
  };
  vm.runInNewContext(source, {
    window, document, console, CustomEvent: class {}, IntersectionObserver: window.IntersectionObserver,
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: (callback) => { queueMicrotask(callback); return 1; }, clearTimeout() {},
  }, { filename: "live2d-viewer.js" });
  await settle(() => window.AnonLive2D.getState().ready && !window.AnonLive2D.getState().loading, "初始模型应可用");
  await tick();
  plays.length = 0;
  return { viewer: window.AnonLive2D, models, plays, elements, pendingModels, buildModel, document, visibility: () => visibility(), intersect: (visible) => intersection([{ isIntersecting: visible }]), renders: () => renderCount, resize: (width, height) => { elements.l2dStage.clientWidth = width; elements.l2dStage.clientHeight = height; resize(); } };
}
const block = (model, resource) => { const pending = deferred(); model.waiting.set(resource, pending); return pending; };

(async () => {
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
    assert.deepEqual(h.elements.l2dMotions.children.map((button) => button.textContent), ["演奏待机", "吉他演奏 1"]);
    const result = await h.viewer.react({ emotion: "smile" });
    assert.equal(result.ok, true, "空表情、无expressionManager的演奏模型仍能响应");
    assert.equal(result.expression, "");
    assert.equal(result.mode, "performance");
    h.elements.l2dMotions.children[1].click();
    await settle(() => h.plays.some((event) => event.name === "mtn_play01_01.motion3.json"), "可以手选真实舞台演奏动作");
    assert.ok(h.plays.every((event) => event.type === "motion"), "不尝试播放不存在的表情");
    assert.match(h.elements.l2dHint.textContent, /已播放「吉他演奏 1」动作/);
  }
  console.log("Live2D viewer 验证通过：8组取消与播放竞态、2组缩放与响应式站位、1组无独立表情演奏模型，共11组。");
})().catch((error) => { console.error(error); process.exitCode = 1; });
