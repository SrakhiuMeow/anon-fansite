/* Cubism 2 / moc3 模型播放器。素材保持同源；不同服装使用各自的真实动作映射。 */
(() => {
  "use strict";
  const data = window.ANON_LIVE2D;
  const actions = window.AnonLive2DActions;
  const byId = (id) => document.getElementById(id);
  const stage = byId("l2dStage");
  const canvas = byId("l2dCanvas");
  if (!data?.costumes?.length || !actions || !stage || !canvas) return;
  const statusEl = byId("l2dStatus");
  const fallbackEl = byId("l2dFallback");
  const hintEl = byId("l2dHint");
  const retryEl = byId("l2dRetry");
  const pauseEl = byId("l2dPause");
  const followMouseEl = byId("l2dFollowMouse");
  const zoomOutEl = byId("l2dZoomOut");
  const zoomInEl = byId("l2dZoomIn");
  const zoomResetEl = byId("l2dZoomReset");
  const zoomValueEl = byId("l2dZoomValue");
  const expressionNoteEl = byId("l2dExpressionNote");
  const costumeLabelEl = byId("l2dCostumeLabel");
  const ZOOM_MIN = 50;
  const ZOOM_MAX = 200;
  const MOBILE_DEFAULT_ZOOM = 150;
  const REACTION_HANDOFF_PROGRESS = 0.8;
  const mobileViewport = window.matchMedia?.("(max-width: 700px)");
  const sourceZoom = (costume) => costume?.source === "https://bdon.moe" ? 180 : 100;
  const defaultZoom = (costume) => mobileViewport?.matches ? MOBILE_DEFAULT_ZOOM : sourceZoom(costume);
  const FOLLOW_MOUSE_STORAGE = "anon-live2d-follow-mouse";
  const hosts = { costume: byId("l2dCostumes"), motion: byId("l2dMotions"), expression: byId("l2dExpressions") };

  // 两代 Core 使用各自专有许可；新版官方 Core 随站点保存，详见 vendor 许可。
  const cubismReady = () => {
    try { return window.Live2DCubismCore?.Version.csmGetVersion() > 0; } catch { return false; }
  };
  const RUNTIME = [
    { name: "PixiJS", path: "npm/pixi.js@6.5.10/dist/browser/pixi.min.js", integrity: "sha384-98eYPI3XO3wKMBW5IUYk3WpffOsMLc+0WSK+ZMutD8S5R6e4E7hKIqFKcdHBLOMB", ready: () => !!window.PIXI?.Application },
    { name: "Cubism 2", path: "gh/dylanNew/live2d@fd9fd400845e9a00bb194fdac0b6635c753a1e8a/webgl/Live2D/lib/live2d.min.js", integrity: "sha384-LWrKEMeBVbWko3WFDXTIBDN5SpFKepeYUI2JE6It+qbq+F+2NvN2QDO2J8H+8Y+O", ready: () => !!window.Live2D },
    { name: "Cubism Core 5.1", url: "assets/vendor/live2dcubismcore-5.1.0.min.js", integrity: "sha384-MeKqhuhBpq1ZqqshjOzqDOQJ/00BuDVdnNeYgPKul9hmgROzmT17WkmUeFJ9Jlrb", ready: cubismReady },
    { name: "Live2D 播放器", path: "npm/pixi-live2d-display@0.4.0/dist/index.min.js", integrity: "sha384-Ukg4e48mEdLvXx4ipNmtVmWcMoKjgs89aotHN/5CB3Bj77JPioyjXXYORMiunxFz", ready: () => !!window.PIXI?.live2d?.Live2DModel },
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
  let zoomPercent = defaultZoom(requested);
  let mobileZoom = MOBILE_DEFAULT_ZOOM;
  let desktopZoom = { costume: requested.id, percent: sourceZoom(requested) };
  let desiredReaction = { emotion: "neutral" };
  let pendingMounts = 0;
  const retiredTextures = new Set();
  const warmups = new WeakMap();
  const variantHistory = new Map();
  const requestSelections = new WeakMap();
  let activeReaction = null;
  const reactionWaiters = new Set();
  const expressionFades = new WeakMap();
  let tracksLegacyExpressionFades = false;
  try { followMouse = localStorage.getItem(FOLLOW_MOUSE_STORAGE) !== "false"; } catch { /* 隐私模式下仍可使用开关 */ }

  const setStatus = (text) => {
    if (!statusEl) return;
    statusEl.hidden = !text;
    statusEl.textContent = text || "";
  };
  const setHint = (text) => { if (hintEl) hintEl.textContent = text; };
  const emitState = () => window.dispatchEvent(new CustomEvent("anon:live2d-state", { detail: getState() }));
  const getState = () => ({ ready: !!model, loading, paused, failed, followMouse, zoomPercent, costume: current?.id || null,
    reactionReady: !!activeReaction && !loading && !paused && inView && !document.hidden && reactionComplete(activeReaction) });
  const syncZoomControls = () => {
    if (zoomValueEl) zoomValueEl.textContent = `${zoomPercent}%`;
    if (zoomOutEl) zoomOutEl.disabled = !model || zoomPercent <= ZOOM_MIN;
    if (zoomInEl) zoomInEl.disabled = !model || zoomPercent >= ZOOM_MAX;
    if (zoomResetEl) {
      const baseline = defaultZoom(current || requested);
      zoomResetEl.disabled = !model || zoomPercent === baseline;
      zoomResetEl.setAttribute("aria-label", `还原模型为默认 ${baseline}%`);
      zoomResetEl.title = `还原为默认 ${baseline}%`;
    }
  };
  const syncMouseTracking = () => {
    if (followMouseEl) {
      followMouseEl.textContent = followMouse ? "跟随鼠标：开" : "跟随鼠标：关";
      followMouseEl.setAttribute("aria-checked", String(followMouse));
      followMouseEl.classList.toggle("is-active", followMouse);
    }
    if (!model) return;
    model.autoInteract = followMouse;
    if (followMouse) {
      model.registerInteraction(app.renderer.plugins.interaction);
    } else {
      // 0.4.0 的 autoInteract setter 不会卸载已注册的 pointermove，需显式解绑。
      model.unregisterInteraction();
      // 关闭后清除上一次指针位置，暂停时也立即回到正向视线。
      model.internalModel.focusController.focus(0, 0, true);
      model.update(1);
      app?.render();
    }
  };
  const markActive = (host, value) => host?.querySelectorAll("button[data-value]").forEach((button) => {
    const active = button.dataset.value === value;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  // 衔接门控随渲染帧检查真实播放进度；离屏后没有额外计时器继续运行。
  const reactionComplete = (reaction) => {
    if (!reaction || reaction.target !== model) return true;
    const manager = reaction.target.internalModel.motionManager;
    const sameMotion = manager.state.currentGroup === reaction.choice.group && manager.state.currentIndex === reaction.choice.index;
    const reachedHandoff = reaction.motionDuration !== null && reaction.motionElapsed >= reaction.motionDuration * REACTION_HANDOFF_PROGRESS;
    // 无法读取时长时仍等真实结束；有时长的动作到80%即可交给下一段自然淡变。
    const motionReady = reachedHandoff || reaction.motionDone || !sameMotion || (manager.isFinished() && !manager.playing);
    return motionReady && reaction.expressionRemaining <= 0;
  };
  const flushReactionWaiters = () => {
    for (const waiter of [...reactionWaiters]) waiter.check();
  };
  const whenReactionComplete = (signal) => {
    const reaction = activeReaction;
    return new Promise((resolve) => {
      const signals = [...new Set([signal, reaction?.signal].filter(Boolean))];
      const finish = (completed) => {
        reactionWaiters.delete(waiter);
        for (const item of signals) item.removeEventListener("abort", waiter.check);
        resolve(completed);
      };
      const waiter = { check: () => {
        if (signals.some((item) => item.aborted) || paused || loading || !inView || document.hidden) return finish(false);
        if (!reaction) return finish(true);
        if (reaction.target !== model || reaction !== activeReaction) return finish(false);
        if (reactionComplete(reaction)) finish(true);
      } };
      reactionWaiters.add(waiter);
      for (const item of signals) item.addEventListener("abort", waiter.check, { once: true });
      waiter.check();
    });
  };
  const fadeDuration = (expression, direction) => {
    const seconds = expression?.[direction === "in" ? "getFadeInTime" : "getFadeOutTime"]?.();
    const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : expressionFades.get(expression)?.[direction];
    return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : window.PIXI?.live2d?.config.expressionFadingDuration || 500;
  };
  const motionDuration = (motion) => {
    // Cubism 2 返回毫秒，Cubism 4 返回秒；循环动作的 duration 为负，改取单轮时长。
    const durations = [motion?.getDurationMSec?.(), motion?.getDuration?.() * 1000,
      motion?.getLoopDurationMSec?.(), motion?.getLoopDuration?.() * 1000];
    return durations.find((duration) => Number.isFinite(duration) && duration > 0) ?? null;
  };
  const playbackTime = (target, legacy) => {
    // Cubism 2 Core 使用自己的毫秒时钟；Cubism 4 使用模型累计渲染时间。
    const nativeTime = legacy ? window.UtSystem?.getUserTimeMSec?.() : undefined;
    return Number.isFinite(nativeTime) ? nativeTime : target.elapsedTime;
  };
  const loadReactionResource = async (manager, type, group, index, isCurrent) => {
    const load = () => type === "motion" ? manager.loadMotion(group, index) : manager.loadExpression(index);
    for (let attempt = 0; attempt < 2 && isCurrent(); attempt++) {
      let resource;
      try { resource = await load(); } catch { /* 瞬断只重试当前资源，不重载整套模型。 */ }
      if (resource) return resource;
      if (attempt || !isCurrent()) break;
      const cache = type === "motion" ? manager.motionGroups?.[group] : manager.expressions;
      if (cache?.[index] != null) continue;
      // 0.4.0 同时缓存空资源和已失败的加载 Promise；两层都需按单项清除。
      // 此时该次加载已结束，不能清除其他资源或仍在预热的请求。
      if (cache) delete cache[index];
      const factory = window.PIXI?.live2d?.Live2DFactory;
      const tasks = type === "motion" ? factory?.motionTasksMap?.get(manager)?.[group] : factory?.expressionTasksMap?.get(manager);
      if (tasks) delete tasks[index];
    }
    return null;
  };
  const syncPlayback = () => {
    const running = !!model && !paused && inView && !document.hidden;
    // Live2D 默认使用共享 ticker；显式关闭并由 app ticker 更新，保证离屏真正停止。
    if (app) running ? app.start() : app.stop();
    if (running) void warmReactions(model, current);
    if (pauseEl) {
      pauseEl.disabled = !model;
      pauseEl.textContent = paused ? "播放动画" : "暂停动画";
      pauseEl.setAttribute("aria-pressed", String(paused));
    }
    syncZoomControls();
    flushReactionWaiters();
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
      for (const url of item.url ? [item.url] : ["https://cdn.jsdelivr.net/", "https://fastly.jsdelivr.net/"].map((host) => host + item.path)) {
        try { await loadScript(url, item.integrity); lastError = null; break; }
        catch (error) { lastError = error; }
      }
      // 新版 Core 内含异步 WASM 初始化；script.onload 并不等于 Core 已能创建模型。
      for (let attempt = 0; !lastError && !item.ready() && attempt < 150; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
      if (lastError || !item.ready()) throw new Error(`${item.name} 暂不可用，请检查网络后重试`);
    }
    // 聊天会同时指定动作与表情，避免动作开始时库自动清空已选表情。
    window.PIXI.live2d.config.preserveExpressionOnMotion = true;
    // Cubism 2 Core 没有公开 fade-in getter，在创建表情时保留其真实时长。
    // Cubism 4 直接读取 getFadeInTime / getFadeOutTime，单位由秒转为毫秒。
    const expressionPrototype = window.PIXI.live2d.Cubism2ExpressionManager?.prototype;
    if (expressionPrototype && !tracksLegacyExpressionFades) {
      const createExpression = expressionPrototype.createExpression;
      expressionPrototype.createExpression = function (definition, ...args) {
        const expression = createExpression.call(this, definition, ...args);
        const fallback = window.PIXI.live2d.config.expressionFadingDuration;
        expressionFades.set(expression, { in: definition.fade_in > 0 ? definition.fade_in : fallback, out: definition.fade_out > 0 ? definition.fade_out : fallback });
        return expression;
      };
      tracksLegacyExpressionFades = true;
    }
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
    const mobileRoom = !!byId("anonRoom")?.classList.contains("mobile-room");
    const baseScale = Math.min((width * 0.86) / nativeW, (height * 0.9) / nativeH);
    const scale = baseScale * zoomPercent / 100;
    // 固定默认站位顶部和水平中心；放大时保留头部，上半身不会被脚底锚点推出画面。
    // 手机竖屏把脸部移到浮层上方；桌面仍用原有构图与缩放比例。
    const top = (height - nativeH * baseScale) / 2 - (mobileRoom ? Math.max(0, height * 0.2 - 30) : 0);
    model.scale.set(scale);
    model.x = width / 2 - (bounds.x + nativeW / 2) * scale;
    model.y = top - bounds.y * scale;
    app.render();
  };
  const setZoom = (percent) => {
    zoomPercent = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, percent));
    if (mobileViewport?.matches) mobileZoom = zoomPercent;
    else desktopZoom = { costume: current?.id || requested.id, percent: zoomPercent };
    fitModel();
    syncZoomControls();
    emitState();
  };
  const buildChips = (host, items, onPick, { clear = true } = {}) => {
    if (!host) return;
    if (clear) host.replaceChildren();
    for (const [value, label, hint] of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.dataset.value = value;
      button.textContent = label;
      if (hint) button.title = hint;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => { void onPick(value); });
      host.appendChild(button);
    }
  };
  // 服装来自两个来源：游戏拆包（Bestdori）与剧情站（Our Notes），按来源分组更易找。
  const costumeHint = (item) => [
    item.kind === "card" && item.cardTitle ? `卡面「${item.cardTitle}」` : "",
    item.appliedAt ? `实装 ${item.appliedAt}` : "",
    item.id,
  ].filter(Boolean).join(" · ");
  const COSTUME_GROUPS = [
    ["游戏服装", (item) => item.kind === "season"],
    ["卡面服装", (item) => item.kind === "card"],
    ["剧情与演奏", (item) => item.kind !== "season" && item.kind !== "card"],
  ];
  const renderCostumes = (onPick) => {
    const host = hosts.costume;
    if (!host) return;
    host.replaceChildren();
    const used = new Set();
    const append = (items) => {
      items.forEach((item) => used.add(item.id));
      buildChips(host, items.map((item) => [item.id, item.label || item.id, costumeHint(item)]), onPick, { clear: false });
    };
    for (const [name, match] of COSTUME_GROUPS) {
      const items = data.costumes.filter((item) => !used.has(item.id) && match(item));
      if (!items.length) continue;
      const heading = document.createElement("span");
      heading.className = "l2d-chip-group";
      heading.textContent = name;
      host.appendChild(heading);
      append(items);
    }
    const rest = data.costumes.filter((item) => !used.has(item.id));
    if (rest.length) append(rest);
  };
  const renderControls = () => {
    renderCostumes(async (id) => {
      const costume = data.costumes.find((item) => item.id === id);
      if (costume && (costume.id !== current?.id || loading)) await mountModel(costume);
    });
    if (costumeLabelEl) costumeLabelEl.textContent = `服装（${data.costumes.length} 套）`;
    markActive(hosts.costume, current.id);
    const performance = current.mode === "performance";
    const motionItems = performance
      ? (current.performanceActions?.map(({ motion, label }) => [motion, label]) || current.motions.map((file, index) => {
        const name = actions.stem(file);
        return [name, current.motionLabels?.[name] || `演奏动作 ${index + 1}`];
      }))
      : MOTIONS.filter(([motion]) => actions.resolve(current, { motion }));
    buildChips(hosts.motion, motionItems, async (motion) => {
      const result = await react({ motion });
      setHint(result.ok ? `已播放「${motionItems.find(([name]) => name === motion)[1]}」动作。` : result.reason);
    });
    buildChips(hosts.expression, EXPRESSIONS.filter(([expression]) => actions.resolve(current, { expression })), async (expression) => {
      const result = await react({ expression });
      setHint(result.ok ? `已切换「${EXPRESSIONS.find(([name]) => name === expression)[1]}」表情。` : result.reason);
    });
    markActive(hosts.expression, "default");
    if (expressionNoteEl) expressionNoteEl.hidden = current.expressions.length > 0;
    setHint(`当前服装有 ${current.motionCount} 个动作、${current.expressionCount} 个独立表情。${performance ? "聊天会自动触发此款真实舞台动作，也可在上方手选；动作结束后恢复待机。" : ""}${paused ? "动画已暂停，可按播放按钮开始。" : "试着打个招呼，或者点选一个动作。"}`);
  };

  const warmReactions = async (target, costume) => {
    // 预热只服务正在观看的动画；省流量模式仅按实际操作加载资源。
    if (!target || paused || !inView || document.hidden || window.navigator?.connection?.saveData) return;
    let state = warmups.get(target);
    if (!state) {
      const choices = new Map();
      for (const emotion of ["neutral", "thinking", "smile", "serious", "cheer", "shy", "surprised", "wave", "wink", "sad", "angry", "cry", "pose"]) {
        const variants = actions.variants
          ? actions.variants(costume, { emotion, source: "chat" }).slice(0, 3)
          : [actions.resolve(costume, { emotion })];
        for (const choice of variants) {
          if (choice) choices.set(`${choice.group}:${choice.index}:${choice.expression || ""}`, choice);
        }
      }
      state = { choices: [...choices.values()], index: 0, running: false };
      warmups.set(target, state);
    }
    if (state.running) return;
    state.running = true;
    try {
      const manager = target.internalModel.motionManager;
      while (state.index < state.choices.length && target === model && !paused && inView && !document.hidden) {
        const choice = state.choices[state.index++];
        const expressionIndex = choice.expression ? manager.expressionManager?.getExpressionIndex(choice.expression) : -1;
        await Promise.allSettled([
          choice.motion ? manager.loadMotion(choice.group, choice.index) : null,
          expressionIndex >= 0 ? manager.expressionManager.loadExpression(expressionIndex) : null,
        ]);
      }
    } finally { state.running = false; }
  };

  const retireModel = (target) => {
    // 播放器默认 destroy 不释放纹理；先退役，等并行换装结束再清理共享缓存。
    for (const texture of target.textures || []) retiredTextures.add(texture);
    target.destroy();
  };
  const releaseRetiredTextures = () => {
    if (pendingMounts) return;
    const retained = new Set((model?.textures || []).map((texture) => texture.baseTexture));
    for (const texture of retiredTextures) {
      if (texture.baseTexture && !retained.has(texture.baseTexture)) texture.destroy(true);
    }
    retiredTextures.clear();
  };

  const mountModel = async (costume) => {
    const version = ++loadVersion;
    ++pendingMounts;
    ++reactionVersion;
    requested = costume;
    loading = true;
    flushReactionWaiters();
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
      if (version !== loadVersion) { retireModel(next); return false; }
      const previous = model;
      const changedCostume = current?.id !== costume.id;
      model = next;
      current = costume;
      activeReaction = null;
      const motionManager = next.internalModel.motionManager;
      motionManager.on?.("motionFinish", () => {
        if (activeReaction?.target === next && motionManager.state.currentGroup === activeReaction.choice.group && motionManager.state.currentIndex === activeReaction.choice.index) {
          activeReaction.motionDone = true;
          flushReactionWaiters();
        }
      });
      // Live2DModel.update 仅累积 delta，Core 到实际 render 才求值。两代均在
      // 表情更新后发此事件：首帧只建立起点，后续仅计入已渲染的进度。
      next.internalModel.on("beforeModelUpdate", () => {
        if (activeReaction?.target !== next) return;
        const motionTime = playbackTime(next, activeReaction.motionLegacy);
        const expressionTime = playbackTime(next, activeReaction.expressionLegacy);
        if (activeReaction.motionRenderedAt !== null) {
          activeReaction.motionElapsed += Math.max(0, motionTime - activeReaction.motionRenderedAt);
        }
        activeReaction.motionRenderedAt = motionTime;
        if (activeReaction.expressionRenderedAt !== null) {
          activeReaction.expressionRemaining = Math.max(0, activeReaction.expressionRemaining - Math.max(0, expressionTime - activeReaction.expressionRenderedAt));
        }
        activeReaction.expressionRenderedAt = expressionTime;
        flushReactionWaiters();
      });
      app.stage.addChild(next);
      if (previous) { app.stage.removeChild(previous); retireModel(previous); }
      // 加载期间也能切换偏好，以完成加载时的最新开关状态为准。
      syncMouseTracking();
      // PIXI 只在 deltaTime 非零时初始化 Core 顶点；暂停换装也需要一个静态首帧。
      next.update(1);
      // 手机沿用最近一次手动比例；桌面不同服装仍采用来源默认，同款重载保留。
      if (mobileViewport?.matches) zoomPercent = mobileZoom;
      else if (changedCostume) {
        zoomPercent = sourceZoom(costume);
        desktopZoom = { costume: costume.id, percent: zoomPercent };
      }
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
      --pendingMounts;
      releaseRetiredTextures();
      if (version === loadVersion) {
        loading = false;
        stage.setAttribute("aria-busy", "false");
        syncPlayback();
        emitState();
        if (model && !desiredReaction.signal?.aborted) void react(desiredReaction, true);
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
          app.ticker.add(() => {
            if (model) model.update(app.ticker.deltaMS);
          });
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
  const signature = (choice) => `${choice.group}:${choice.motion || ""}:${choice.expression || ""}`;
  const responseFor = (costume, choice) => {
    const actionLabel = costume.mode === "performance"
      ? costume.performanceActions?.find((item) => item.motion === choice.motion)?.label || "舞台动作"
      : undefined;
    return { ok: true, motion: choice.motion, expression: choice.expression, emotion: choice.emotion, mode: costume.mode || "story", ...(actionLabel ? { actionLabel } : {}) };
  };
  const rememberSelection = (request, costume, choice, ordinal) => {
    const record = requestSelections.get(request) || { byCostume: new Map() };
    record.last = { choice, ordinal };
    record.byCostume.set(costume.id, record.last);
    requestSelections.set(request, record);
  };
  const chooseReaction = (costume, request, replay) => {
    const initial = actions.resolve(costume, request);
    if (!initial) return null;
    if (request.source !== "chat" || !actions.variants) return { choice: initial, ordinal: 0 };
    const candidates = actions.variants(costume, request);
    if (!candidates.length) return null;
    const record = replay ? requestSelections.get(request) : undefined;
    const previous = record?.byCostume.get(costume.id) || record?.last;
    if (previous) {
      const exact = candidates.findIndex((choice) => signature(choice) === signature(previous.choice));
      const ordinal = exact >= 0 ? exact : previous.ordinal % candidates.length;
      return { choice: candidates[ordinal], ordinal, consume: false };
    }
    const history = variantHistory.get(`${costume.id}:${initial.emotion}`);
    const activeChoice = activeReaction?.target === model ? activeReaction.choice : null;
    const previousChoice = activeChoice || history;
    const changeScore = (choice) => previousChoice
      ? (choice.motion !== previousChoice.motion ? 1 : 0) + (choice.expression !== previousChoice.expression ? 1 : 0) : 0;
    if (!history) {
      let ordinal = 0;
      for (let index = 1; index < candidates.length; index++) {
        if (changeScore(candidates[index]) > changeScore(candidates[ordinal])) ordinal = index;
      }
      return { choice: candidates[ordinal], ordinal, consume: true, resetCycle: false };
    }
    const start = (candidates.findIndex((choice) => signature(choice) === history.signature) + 1) % candidates.length;
    const unused = candidates.map((choice, index) => !history.used.has(signature(choice)) ? index : -1).filter((index) => index >= 0);
    // 跨语气可能已播放本语气仅剩的组合。此时重开候选轮次，避免为完成
    // 历史覆盖而强制重复当前组合（演奏款会只剩上一动作最后20%）。
    const repeatsCurrent = activeChoice && unused.length > 0
      && unused.every((index) => signature(candidates[index]) === signature(activeChoice))
      && candidates.some((choice) => signature(choice) !== signature(activeChoice));
    const resetCycle = unused.length === 0 || repeatsCurrent;
    const eligible = new Set(resetCycle ? candidates.map((_, index) => index) : unused);
    // 每轮先覆盖所有候选，避免双不同评分长期跳过同动作/表情的候选。
    // 在本轮未用候选内，仍优先同时换动作与表情。
    let ordinal = start;
    let bestScore = -1;
    for (let offset = 0; offset < candidates.length; offset++) {
      const index = (start + offset) % candidates.length;
      if (!eligible.has(index)) continue;
      const choice = candidates[index];
      const score = changeScore(choice);
      if (score > bestScore) { ordinal = index; bestScore = score; }
      if (score === 2) break;
    }
    return { choice: candidates[ordinal], ordinal, consume: true, resetCycle };
  };
  const react = async (request = {}, replay = false) => {
    const { signal } = request;
    if (signal?.aborted) return { ok: false, reason: "这段对话已停止。" };
    desiredReaction = request;
    ++reactionVersion;
    if (!model && !(await start())) return { ok: false, reason: "文字回复已送达；模型暂不可用，可点重试。" };
    if (signal?.aborted || desiredReaction !== request) return { ok: false, reason: "这段对话已停止或被更新。" };
    if (loading) return { ok: false, reason: "文字回复已送达；正在换装，完成后播放最新回应。" };
    if (paused) return { ok: false, reason: "文字回复已送达；动画已暂停，点播放后再试。" };
    if (!inView || document.hidden) return { ok: false, reason: "文字回复已送达；模型在可见时播放动作。" };
    const version = ++reactionVersion;
    const target = model;
    const costume = current;
    const motionManager = target.internalModel.motionManager;
    const activeChoice = activeReaction?.target === target ? activeReaction.choice : null;
    const idleMotion = actions.resolve(costume, { emotion: "neutral" })?.motion;
    if (request.source === "chat" && request.continuation && activeChoice?.motion && activeChoice.motion !== idleMotion
      && motionManager.state.currentGroup === activeChoice.group && motionManager.state.currentIndex === activeChoice.index && !motionManager.isFinished()
      && !reactionComplete(activeReaction)) {
      // 尚未达到80%衔接点时保留实际姿态，不打断，也不消耗下一候选。
      rememberSelection(request, costume, activeChoice, activeReaction.ordinal);
      return responseFor(costume, activeChoice);
    }
    const selection = chooseReaction(costume, request, replay);
    if (!selection) return { ok: false, reason: "当前服装没有这个动作或表情。" };
    const { choice, ordinal } = selection;
    const { motion, expression, group, index } = choice;
    try {
      const expressionManager = motionManager.expressionManager;
      const expressionIndex = expression ? expressionManager?.getExpressionIndex(expression) : -1;
      const isCurrent = () => !signal?.aborted && version === reactionVersion && target === model && !paused && inView && !document.hidden;
      // 先加载，后检查版本再播放：迟到的旧请求不能把停止/新情绪覆盖回去。
      const loaded = await Promise.all([
        motion ? loadReactionResource(motionManager, "motion", group, index, isCurrent) : null,
        expressionIndex >= 0 ? loadReactionResource(expressionManager, "expression", null, expressionIndex, isCurrent) : null,
      ]);
      if (signal?.aborted || version !== reactionVersion || target !== model || paused || !inView || document.hidden) return { ok: false, reason: "已响应较新的操作，或模型已暂停。" };
      if ((motion && !loaded[0]) || (expression && !loaded[1])) return { ok: false, reason: "文字回复已送达；动作或表情资源暂不可用，请重试。" };
      // 库对“重复设置当前表情”返回 false，但该表情确实已生效，不应误报失败。
      const expressionIsCurrent = expressionIndex >= 0 && expressionManager.expressions[expressionIndex] === expressionManager.currentExpression;
      const previousExpression = expressionManager?.currentExpression;
      const motionIsCurrent = motion && motionManager.state.currentGroup === group && motionManager.state.currentIndex === index && !motionManager.isFinished();
      const results = await Promise.all([
        motion && !motionIsCurrent ? target.motion(group, index, window.PIXI.live2d.MotionPriority.FORCE) : true,
        expression && !expressionIsCurrent ? target.expression(expression) : true,
      ]);
      if (signal?.aborted || version !== reactionVersion || target !== model) return { ok: false, reason: "已响应较新的操作。" };
      if (results.some((result) => result === false)) return { ok: false, reason: "文字回复已送达；动作未能播放，请再试一次。" };
      const expressionRemaining = expression && !expressionIsCurrent
        ? Math.max(fadeDuration(loaded[1], "in"), previousExpression ? fadeDuration(previousExpression, "out") : 0) * REACTION_HANDOFF_PROGRESS
        : activeReaction?.target === target ? activeReaction.expressionRemaining : 0;
      const expressionRenderedAt = expression && !expressionIsCurrent ? null
        : activeReaction?.target === target ? activeReaction.expressionRenderedAt : null;
      const expressionLegacy = expression && !expressionIsCurrent ? expressionFades.has(loaded[1])
        : activeReaction?.target === target ? activeReaction.expressionLegacy : false;
      // 同动作继续自然播放剩余部分，保留原进度；强行重启会被库拒绝且容易产生跳变。
      const samePlayback = motionIsCurrent && activeChoice?.group === group && activeChoice?.index === index;
      activeReaction = { target, choice, ordinal, signal, expressionRemaining, expressionRenderedAt, expressionLegacy,
        motionDuration: motionDuration(loaded[0]),
        motionLegacy: typeof loaded[0]?.getDurationMSec === "function",
        motionElapsed: samePlayback ? activeReaction.motionElapsed : 0,
        motionRenderedAt: samePlayback ? activeReaction.motionRenderedAt : null,
        motionDone: !motion || motion === idleMotion };
      flushReactionWaiters();
      rememberSelection(request, costume, choice, ordinal);
      if (request.source === "chat") {
        const key = `${costume.id}:${choice.emotion}`;
        const used = new Set(selection.resetCycle ? [] : variantHistory.get(key)?.used || []);
        if (selection.consume) used.add(signature(choice));
        variantHistory.set(key, { signature: signature(choice), motion: choice.motion, expression: choice.expression, used });
      }
      if (motion) markActive(hosts.motion, current.mode === "performance" ? motion : actions.defaults[choice.emotion]?.motion || motion);
      if (expression) markActive(hosts.expression, actions.defaults[choice.emotion]?.expression || expression);
      return responseFor(costume, choice);
    } catch (error) {
      console.warn("Live2D reaction:", error);
      return { ok: false, reason: "文字回复已送达；动作资源加载失败，请重试。" };
    }
  };

  window.AnonLive2D = { react, whenReactionComplete, retry: start, getState };
  mobileViewport?.addEventListener?.("change", () => {
    zoomPercent = mobileViewport.matches ? mobileZoom
      : desktopZoom.costume === (current?.id || requested.id) ? desktopZoom.percent : sourceZoom(current || requested);
    fitModel();
    syncZoomControls();
    emitState();
  });
  zoomOutEl?.addEventListener("click", () => setZoom(zoomPercent - 10));
  zoomInEl?.addEventListener("click", () => setZoom(zoomPercent + 10));
  zoomResetEl?.addEventListener("click", () => setZoom(defaultZoom(current || requested)));
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
    ++reactionVersion;
    syncPlayback();
    setHint(paused ? "动画已暂停，仍可发送文字。" : "动画继续播放。输入一句话，试试爱音的反应吧。" );
    emitState();
    if (!paused && !desiredReaction.signal?.aborted) void react(desiredReaction, true);
  });
  document.addEventListener("visibilitychange", () => {
    syncPlayback();
    if (!document.hidden && inView && !desiredReaction.signal?.aborted) void react(desiredReaction, true);
  });
  if ("ResizeObserver" in window) new ResizeObserver(fitModel).observe(stage);
  else window.addEventListener("resize", fitModel);
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      const wasInView = inView;
      inView = entries.some((entry) => entry.isIntersecting);
      if (inView && !document.hidden && !model && !failed) void start();
      syncPlayback();
      if (!wasInView && inView && model && !desiredReaction.signal?.aborted) void react(desiredReaction, true);
    }, { threshold: 0 });
    observer.observe(stage);
  } else { inView = true; if (!document.hidden) void start(); }
  syncMouseTracking();
  syncPlayback();
})();
