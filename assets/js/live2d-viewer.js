/* =========================================================
   Live2D 播放器
   数据：assets/data/anon-live2d.js（由 scripts/fetch_live2d.py 生成）
   运行时：pixi.js + Live2D Cubism 2 Core + pixi-live2d-display（CDN 加载）
   模型文件：assets/live2d/<服装>/（Cubism 2.1，来自 Bestdori 的游戏拆包资源）
   ========================================================= */

(() => {
  "use strict";

  const data = window.ANON_LIVE2D;
  const stage = document.getElementById("l2dStage");
  const canvas = document.getElementById("l2dCanvas");
  const statusEl = document.getElementById("l2dStatus");
  const fallbackEl = document.getElementById("l2dFallback");
  const costumesEl = document.getElementById("l2dCostumes");
  const motionsEl = document.getElementById("l2dMotions");
  const expressionsEl = document.getElementById("l2dExpressions");
  const hintEl = document.getElementById("l2dHint");

  if (!data || !stage || !canvas) return;

  /* ---------- 运行时来源 ---------- */
  // 说明：Cubism 2（旧版）核心已不在 Live2D 官方 CDN 上，这里使用社区镜像；
  // 如果要长期上线，建议把运行时换到自建 CDN 并确认 Live2D 的授权条款。
  const RUNTIME = [
    { name: "pixi.js", url: "https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js" },
    { name: "Cubism 2 Core", url: "https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js" },
    { name: "pixi-live2d-display", url: "https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism2.min.js" },
  ];

  /* ---------- 界面用到的动作 / 表情（挑好看的几组） ---------- */
  const MOTION_PICKS = [
    ["idle01", "待机"],
    ["smile01", "微笑"],
    ["wink01", "眨眼"],
    ["bye01", "挥手"],
    ["kandou01", "感动"],
    ["kime01", "摆姿势"],
    ["shame01", "害羞"],
    ["surprised01", "吃惊"],
    ["thinking01", "思考"],
    ["angry01", "生气"],
    ["cry01", "哭泣"],
    ["serious01", "认真"],
  ];
  const EXPRESSION_PICKS = [
    ["default", "默认"],
    ["smile01", "微笑"],
    ["wink01", "眨眼"],
    ["shame01", "害羞"],
    ["surprised01", "吃惊"],
    ["thinking01", "思考"],
    ["serious01", "认真"],
    ["angry01", "生气"],
    ["sad01", "难过"],
    ["cry01", "哭泣"],
  ];

  const setStatus = (text) => {
    if (!statusEl) return;
    if (text === null) {
      statusEl.hidden = true;
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = text;
  };

  const showFallback = (reason) => {
    setStatus(null);
    if (fallbackEl) {
      fallbackEl.hidden = false;
      const note = fallbackEl.querySelector("p");
      if (note && reason) note.textContent = reason;
    }
  };

  const loadScript = (url) =>
    new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = url;
      el.async = false;
      el.onload = () => resolve(url);
      el.onerror = () => reject(new Error(`加载失败：${url}`));
      document.head.appendChild(el);
    });

  const loadRuntime = async () => {
    for (const item of RUNTIME) {
      setStatus(`正在加载 ${item.name}…`);
      await loadScript(item.url);
    }
    if (!window.PIXI || !window.PIXI.live2d || !window.PIXI.live2d.Live2DModel) {
      throw new Error("运行时已加载，但没有找到 Live2DModel");
    }
  };

  /* ---------- 播放器 ---------- */
  let app = null;
  let model = null;
  let current = null;

  const fitModel = () => {
    if (!app || !model) return;
    const apply = () => {
      if (!app || !model) return;
      const { width, height } = app.screen;
      // 注意：Cubism 2 的 getLocalBounds() 在第一帧后才会给出真实几何，
      // 所以这里会先摆一次，等模型更新一帧后再量一次重摆。
      const bounds = model.getLocalBounds();
      const nativeW = bounds.width || model.internalModel.width || 2000;
      const nativeH = bounds.height || model.internalModel.height || 2500;
      // Cubism 2 的模型实际绘制范围会比 canvas 边界更大，这里留出余量并垂直居中
      const scale = Math.min((width * 0.8) / nativeW, (height * 0.78) / nativeH);
      model.scale.set(scale);
      model.x = (width - nativeW * scale) / 2 - bounds.x * scale;
      model.y = (height - nativeH * scale) / 2 - bounds.y * scale;
    };
    apply();
    window.setTimeout(apply, 600);
  };

  const buildChips = (host, items, isActive, onPick) => {
    if (!host) return;
    host.innerHTML = "";
    items.forEach(([value, label], index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (isActive(value) ? " is-active" : "");
      btn.textContent = label;
      btn.dataset.value = value;
      btn.dataset.index = String(index);
      btn.addEventListener("click", () => {
        host.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-active", c === btn));
        onPick(value, index);
      });
      host.appendChild(btn);
    });
  };

  const costumeLabel = (costume) => costume.label || costume.id;
  const motionIndex = (costume, name) => costume.motions.findIndex((m) => m.startsWith(name));
  const hasExpression = (costume, name) => costume.expressions.includes(name);

  const playMotion = (name) => {
    if (!model || !current) return;
    const index = motionIndex(current, name);
    if (index < 0) return;
    model.motion("idle", index);
  };

  const playExpression = (name) => {
    if (!model || !current) return;
    if (hasExpression(current, name)) {
      model.expression(name);
    }
  };

  const renderControls = () => {
    buildChips(
      costumesEl,
      data.costumes.map((c) => [c.id, costumeLabel(c)]),
      (value) => current && value === current.id,
      async (value) => {
        const costume = data.costumes.find((c) => c.id === value);
        if (!costume || !current || costume.id === current.id) return;
        await mountModel(costume);
      }
    );

    const availableMotions = MOTION_PICKS.filter(([name]) => motionIndex(current, name) >= 0);
    buildChips(
      motionsEl,
      availableMotions,
      () => false,
      (name) => playMotion(name)
    );

    const availableExpressions = EXPRESSION_PICKS.filter(([name]) => hasExpression(current, name));
    buildChips(
      expressionsEl,
      availableExpressions,
      (value) => value === "default",
      (name) => playExpression(name)
    );

    if (hintEl) {
      hintEl.textContent = `当前模型共 ${current.motionCount} 个动作、${current.expressionCount} 个表情，界面里挑了常用的几组。`;
    }
  };

  const mountModel = async (costume) => {
    try {
      if (model) {
        app.stage.removeChild(model);
        model.destroy();
        model = null;
      }
      current = costume;
      setStatus(`正在加载模型 ${costumeLabel(costume)}…`);
      model = await window.PIXI.live2d.Live2DModel.from(costume.modelJson, {
        autoInteract: true,
        autoUpdate: true,
      });
      app.stage.addChild(model);
      fitModel();
      setStatus(null);
      playMotion("idle01");
      renderControls();
    } catch (error) {
      showFallback(`模型加载失败：${error.message}`);
    }
  };

  const start = async () => {
    try {
      await loadRuntime();
      setStatus("正在创建画布…");
      app = new window.PIXI.Application({
        view: canvas,
        backgroundAlpha: 0,
        antialias: true,
        autoStart: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        resizeTo: stage,
      });
      if (model === null && current === null) {
        await mountModel(data.costumes[0]);
      }
    } catch (error) {
      showFallback(`Live2D 运行时加载失败：${error.message}`);
    }
  };

  /* ---------- 滚动到附近再加载，省流量 ---------- */
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      },
      { rootMargin: "300px 0px" }
    );
    io.observe(stage);
  } else {
    start();
  }
})();
