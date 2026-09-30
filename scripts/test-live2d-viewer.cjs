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
async function harness() {
  const names = ["l2dStage", "l2dCanvas", "l2dStatus", "l2dFallback", "l2dHint", "l2dRetry", "l2dPause", "l2dFollowMouse", "l2dCostumes", "l2dMotions", "l2dExpressions"];
  const elements = Object.fromEntries(names.map((name) => [name, new Element()]));
  const defaults = Object.values(actions.defaults);
  const motions = [...new Set(defaults.map((item) => item.motion))].map((name) => name + ".mtn");
  const expressions = [...new Set(defaults.map((item) => item.expression))];
  const costumes = ["first", "second"].map((id) => ({ id, modelJson: id, label: id, motions, expressions, motionCount: motions.length, expressionCount: expressions.length }));
  const models = [];
  const plays = [];
  const pendingModels = new Map();
  const buildModel = (id) => {
    const waiting = new Map();
    const expressionObjects = expressions.map((name) => ({ name }));
    const expressionManager = {
      expressions: expressionObjects,
      currentExpression: null,
      getExpressionIndex: (name) => expressions.indexOf(name),
      loadExpression: (index) => waiting.get("expression:" + expressions[index])?.promise || Promise.resolve(expressionObjects[index]),
    };
    const manager = {
      expressionManager, state: { currentGroup: null, currentIndex: -1 }, isFinished: () => false,
      loadMotion: (group, index) => waiting.get("motion:" + motions[index].replace(".mtn", ""))?.promise || Promise.resolve({ group, index }),
    };
    const model = {
      id, waiting, destroyed: false, scale: { set() {} },
      internalModel: { motionManager: manager, focusController: { focus() {} } },
      getLocalBounds: () => ({ x: 0, y: 0, width: 2000, height: 2500 }),
      registerInteraction() {}, unregisterInteraction() {}, update() {},
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
  const document = { hidden: false, getElementById: (id) => elements[id], createElement: () => new Element(), addEventListener: (type, handler) => { if (type === "visibilitychange") visibility = handler; } };
  const window = {
    ANON_LIVE2D: { defaultCostume: "first", costumes }, AnonLive2DActions: actions,
    Live2D: {}, Live2DCubismCore: { Version: { csmGetVersion: () => 83951616 } },
    PIXI: {
      Application: class {
        constructor() { this.ticker = { add() {} }; this.renderer = { resize() {}, plugins: { interaction: {} } }; this.stage = { addChild() {}, removeChild() {} }; }
        start() {} stop() {} render() {}
      },
      live2d: { config: {}, MotionPriority: { FORCE: 3 }, MotionPreloadStrategy: { IDLE: "IDLE" }, Live2DModel: { from: async (id) => pendingModels.has(id) ? pendingModels.get(id).promise : buildModel(id) } },
    },
    addEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false }),
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
  return { viewer: window.AnonLive2D, models, plays, elements, pendingModels, buildModel, document, visibility: () => visibility(), intersect: (visible) => intersection([{ isIntersecting: visible }]) };
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
  console.log("Live2D viewer 竞态验证通过：新情绪抢占、流中取消、暂停恢复、换装、离屏、已取消请求不复活、预加载失败及重复动作，共8组。");
})().catch((error) => { console.error(error); process.exitCode = 1; });
