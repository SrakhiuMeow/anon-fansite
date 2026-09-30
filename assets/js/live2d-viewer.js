/* Cubism 2.1 真正模型播放器。素材保持同源；运行时固定版本与完整性校验。 */
(() => {
  "use strict";
  const data = window.ANON_LIVE2D;
  const byId = (id) => document.getElementById(id);
  const stage = byId("l2dStage");
  const canvas = byId("l2dCanvas");
  if (!data?.costumes?.length || !stage || !canvas) return;
  const statusEl = byId("l2dStatus");
  const fallbackEl = byId("l2dFallback");
  const hintEl = byId("l2dHint");
  const retryEl = byId("l2dRetry");
  const pauseEl = byId("l2dPause");
  const followMouseEl = byId("l2dFollowMouse");
  const FOLLOW_MOUSE_STORAGE = "anon-live2d-follow-mouse";
  const hosts = { costume: byId("l2dCostumes"), motion: byId("l2dMotions"), expression: byId("l2dExpressions") };

  // Core 是 Live2D 专有运行时（非 MIT）；镜像由 pixi-live2d-display 文档推荐。
  // 固定至原始 SDK 2.1.00_1 提交，许可及来源见项目 README。
  const RUNTIME = [
    { name: "PixiJS", path: "npm/pixi.js@6.5.10/dist/browser/pixi.min.js", integrity: "sha384-98eYPI3XO3wKMBW5IUYk3WpffOsMLc+0WSK+ZMutD8S5R6e4E7hKIqFKcdHBLOMB", ready: () => !!window.PIXI?.Application },
    { name: "Cubism 2", path: "gh/dylanNew/live2d@fd9fd400845e9a00bb194fdac0b6635c753a1e8a/webgl/Live2D/lib/live2d.min.js", integrity: "sha384-LWrKEMeBVbWko3WFDXTIBDN5SpFKepeYUI2JE6It+qbq+F+2NvN2QDO2J8H+8Y+O", ready: () => !!window.Live2D },
    { name: "Live2D 播放器", path: "npm/pixi-live2d-display@0.4.0/dist/cubism2.min.js", integrity: "sha384-410ROfU/36nOSxh+9HKnuS7NRhqQbOIkVaSutIA+NOfjyqSXLVQ8BvTWbmHcY7Gf", ready: () => !!window.PIXI?.live2d?.Live2DModel },
  ];
  const MOTIONS = [["idle01", "待机"], ["smile01", "微笑"], ["wink01", "眨眼"], ["bye01", "挥手"], ["kandou01", "感动"], ["kime01", "摆姿势"], ["shame01", "害羞"], ["surprised01", "吃惊"], ["thinking01", "思考"], ["angry01", "生气"], ["cry01", "哭泣"], ["serious01", "认真"]];
  const EXPRESSIONS = [["default", "默认"], ["smile01", "微笑"], ["wink01", "眨眼"], ["shame01", "害羞"], ["surprised01", "吃惊"], ["thinking01", "思考"], ["serious01", "认真"], ["angry01", "生气"], ["sad01", "难过"], ["cry01", "哭泣"]];
  let app = null;
  let model = null;
  let current = null;
  let requested = data.costumes.find((item) => item.id === data.defaultCostume) || data.costumes[0];
  let starting = null;
  let loadVersion = 0;
  let reactionVersion = 0;
  let inView = false;
  let paused = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
  let loading = false;
  let failed = false;
  let layoutTimer = null;
  let followMouse = true;
  try { followMouse = localStorage.getItem(FOLLOW_MOUSE_STORAGE) !== "false"; } catch { /* 隐私模式下仍可使用开关 */ }

  const setStatus = (text) => {
    if (!statusEl) return;
    statusEl.hidden = !text;
    statusEl.textContent = text || "";
  };
  const setHint = (text) => { if (hintEl) hintEl.textContent = text; };
  const emitState = () => window.dispatchEvent(new CustomEvent("anon:live2d-state", { detail: getState() }));
  const getState = () => ({ ready: !!model, loading, paused, failed, followMouse, costume: current?.id || null });
  const syncMouseTracking = () => {
    if (followMouseEl) {
      followMouseEl.textContent = followMouse ? "跟随鼠标：开" : "跟随鼠标：关";
      followMouseEl.setAttribute("aria-checked", String(followMouse));
      followMouseEl.classList.toggle("is-active", followMouse);
    }
    if (!model) return;
    model.autoInteract = followMouse;
    if (!followMouse) {
      // 关闭后清除上一次指针位置，暂停时也立即回到正向视线。
      model.internalModel.focusController.focus(0, 0, true);
      model.update(0);
      app?.render();
    }
  };
  const markActive = (host, value) => host?.querySelectorAll("button[data-value]").forEach((button) => {
    const active = button.dataset.value === value;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const syncPlayback = () => {
    const running = !!model && !paused && inView && !document.hidden;
    // Live2D 默认使用共享 ticker；显式关闭并由 app ticker 更新，保证离屏真正停止。
    if (app) running ? app.start() : app.stop();
    if (pauseEl) {
      pauseEl.disabled = !model;
      pauseEl.textContent = paused ? "播放动画" : "暂停动画";
      pauseEl.setAttribute("aria-pressed", String(paused));
    }
  };
  const showFailure = (text) => {
    failed = true;
    if (model) {
      setStatus(null);
      setHint(`${text}，已保留当前服装。`);
    } else if (fallbackEl) {
      fallbackEl.hidden = false;
      const note = fallbackEl.querySelector("p");
      if (note) note.textContent = text;
      setStatus(null);
    } else setStatus(text);
    if (retryEl) retryEl.hidden = false;
    emitState();
  };

  const loadScript = (url, integrity) => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const finish = (error) => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (error) { script.remove(); reject(error); } else resolve();
    };
    const timer = setTimeout(() => finish(new Error("资源请求超时")), 15000);
    script.async = false;
    script.crossOrigin = "anonymous";
    script.integrity = integrity;
    script.src = url;
    script.onload = () => finish();
    script.onerror = () => finish(new Error("资源加载或完整性校验失败"));
    document.head.appendChild(script);
  });
  const loadRuntime = async () => {
    for (const item of RUNTIME) {
      if (item.ready()) continue;
      setStatus(`正在加载 ${item.name}…`);
      let lastError;
      for (const host of ["https://cdn.jsdelivr.net/", "https://fastly.jsdelivr.net/"]) {
        try { await loadScript(host + item.path, item.integrity); lastError = null; break; }
        catch (error) { lastError = error; }
      }
      if (lastError || !item.ready()) throw new Error(`${item.name} 暂不可用，请检查网络后重试`);
    }
    // 聊天会同时指定动作与表情，避免动作开始时库自动清空已选表情。
    window.PIXI.live2d.config.preserveExpressionOnMotion = true;
  };

  const fitModel = () => {
    if (!app) return;
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    app.renderer.resize(width, height);
    if (!model) return;
    const bounds = model.getLocalBounds();
    const nativeW = bounds.width || model.internalModel.width || 2000;
    const nativeH = bounds.height || model.internalModel.height || 2500;
    const scale = Math.min((width * 0.86) / nativeW, (height * 0.9) / nativeH);
    model.scale.set(scale);
    model.x = (width - nativeW * scale) / 2 - bounds.x * scale;
    model.y = (height - nativeH * scale) / 2 - bounds.y * scale;
    app.render();
  };
  const buildChips = (host, items, onPick) => {
    if (!host) return;
    host.replaceChildren();
    for (const [value, label] of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.dataset.value = value;
      button.textContent = label;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => { void onPick(value); });
      host.appendChild(button);
    }
  };
  const motionIndex = (costume, name) => costume?.motions.findIndex((item) => item === `${name}.mtn`) ?? -1;
  const renderControls = () => {
    buildChips(hosts.costume, data.costumes.map((item) => [item.id, item.label || item.id]), async (id) => {
      const costume = data.costumes.find((item) => item.id === id);
      if (costume && (costume.id !== current?.id || loading)) await mountModel(costume);
    });
    markActive(hosts.costume, current.id);
    buildChips(hosts.motion, MOTIONS.filter(([name]) => motionIndex(current, name) >= 0), async (motion) => {
      const result = await react({ motion });
      setHint(result.ok ? `已播放「${MOTIONS.find(([name]) => name === motion)[1]}」动作。` : result.reason);
    });
    buildChips(hosts.expression, EXPRESSIONS.filter(([name]) => current.expressions.includes(name)), async (expression) => {
      const result = await react({ expression });
      setHint(result.ok ? `已切换「${EXPRESSIONS.find(([name]) => name === expression)[1]}」表情。` : result.reason);
    });
    markActive(hosts.expression, "default");
    setHint(`当前服装有 ${current.motionCount} 个动作、${current.expressionCount} 个表情。${paused ? "动画已暂停，可按播放按钮开始。" : "试着打个招呼，或者点选一个动作。"}`);
  };

  const mountModel = async (costume) => {
    const version = ++loadVersion;
    ++reactionVersion;
    requested = costume;
    loading = true;
    failed = false;
    stage.setAttribute("aria-busy", "true");
    if (fallbackEl) fallbackEl.hidden = true;
    if (retryEl) retryEl.hidden = true;
    setStatus(`正在换上${costume.label || costume.id}…`);
    emitState();
    try {
      const next = await window.PIXI.live2d.Live2DModel.from(costume.modelJson, {
        autoInteract: followMouse, autoUpdate: false, idleMotionGroup: "idle",
        motionPreload: window.PIXI.live2d.MotionPreloadStrategy.IDLE,
      });
      if (version !== loadVersion) { next.destroy(); return false; }
      const previous = model;
      model = next;
      current = costume;
      app.stage.addChild(next);
      if (previous) { app.stage.removeChild(previous); previous.destroy(); }
      // 加载期间也能切换偏好，以完成加载时的最新开关状态为准。
      syncMouseTracking();
      next.update(0);
      fitModel();
      clearTimeout(layoutTimer);
      layoutTimer = setTimeout(() => { if (version === loadVersion) fitModel(); }, 150);
      setStatus(null);
      renderControls();
      return true;
    } catch (error) {
      if (version === loadVersion) {
        showFailure("模型暂时加载失败，请重试");
        markActive(hosts.costume, current?.id);
        console.warn("Live2D model:", error);
      }
      return false;
    } finally {
      if (version === loadVersion) {
        loading = false;
        stage.setAttribute("aria-busy", "false");
        syncPlayback();
        emitState();
      }
    }
  };

  const start = () => {
    if (starting) return starting;
    if (model && !failed) return Promise.resolve(true);
    loading = true;
    emitState();
    starting = (async () => {
      try {
        await loadRuntime();
        if (!app) {
          app = new window.PIXI.Application({
            view: canvas, backgroundAlpha: 0, antialias: true, autoStart: false,
            resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true,
          });
          app.ticker.add(() => { if (model) model.update(app.ticker.deltaMS); });
        }
        return await mountModel(requested);
      } catch (error) {
        showFailure(error.message || "Live2D 暂不可用，请重试");
        return false;
      } finally { loading = false; starting = null; emitState(); }
    })();
    return starting;
  };

  // 所有按钮与聊天使用同一入口；只有动作/表情的 Promise 成功才返回 ok。
  const react = async ({ motion, expression } = {}) => {
    if (!model && !(await start())) return { ok: false, reason: "文字回复已送达；模型暂不可用，可点重试。" };
    if (loading) return { ok: false, reason: "文字回复已送达；正在换装，稍后再试动作。" };
    if (paused) return { ok: false, reason: "文字回复已送达；动画已暂停，点播放后再试。" };
    if (!inView || document.hidden) return { ok: false, reason: "文字回复已送达；模型在可见时播放动作。" };
    const version = ++reactionVersion;
    const target = model;
    const index = motion ? motionIndex(current, motion) : -1;
    if ((motion && index < 0) || (expression && !current.expressions.includes(expression))) return { ok: false, reason: "当前服装没有这个动作或表情。" };
    try {
      const expressionManager = target.internalModel.motionManager.expressionManager;
      const expressionIndex = expression ? expressionManager?.getExpressionIndex(expression) : -1;
      // 库对“重复设置当前表情”返回 false，但该表情确实已生效，不应误报失败。
      const expressionIsCurrent = expressionIndex >= 0 && expressionManager.expressions[expressionIndex] === expressionManager.currentExpression;
      const results = await Promise.all([
        motion ? target.motion("reaction", index, window.PIXI.live2d.MotionPriority.FORCE) : true,
        expression && !expressionIsCurrent ? target.expression(expression) : true,
      ]);
      if (version !== reactionVersion || target !== model) return { ok: false, reason: "已响应较新的操作。" };
      if (results.some((result) => result === false)) return { ok: false, reason: "文字回复已送达；动作未能播放，请再试一次。" };
      if (motion) markActive(hosts.motion, motion);
      if (expression) markActive(hosts.expression, expression);
      return { ok: true, motion, expression };
    } catch (error) {
      console.warn("Live2D reaction:", error);
      return { ok: false, reason: "文字回复已送达；动作资源加载失败，请重试。" };
    }
  };

  window.AnonLive2D = { react, retry: start, getState };
  retryEl?.addEventListener("click", () => { void start(); });
  followMouseEl?.addEventListener("click", () => {
    followMouse = !followMouse;
    try { localStorage.setItem(FOLLOW_MOUSE_STORAGE, String(followMouse)); } catch { /* 无法保存时仅本次有效 */ }
    syncMouseTracking();
    setHint(followMouse ? "已开启跟随鼠标，移动鼠标试试看。" : "已关闭跟随鼠标，仍可使用对话、动作和表情。" );
    emitState();
  });
  pauseEl?.addEventListener("click", () => {
    paused = !paused;
    syncPlayback();
    setHint(paused ? "动画已暂停，仍可发送文字。" : "动画继续播放。输入一句话，试试爱音的反应吧。" );
    emitState();
  });
  document.addEventListener("visibilitychange", syncPlayback);
  if ("ResizeObserver" in window) new ResizeObserver(fitModel).observe(stage);
  else window.addEventListener("resize", fitModel);
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      inView = entries.some((entry) => entry.isIntersecting);
      if (inView && !model && !failed) void start();
      syncPlayback();
    }, { threshold: 0 });
    observer.observe(stage);
  } else { inView = true; void start(); }
  syncMouseTracking();
  syncPlayback();
})();
