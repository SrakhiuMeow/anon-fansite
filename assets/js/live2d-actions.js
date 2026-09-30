/* 将对话语义映射到每套模型实际提供的动作；不修改原模型参数。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AnonLive2DActions = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const defaults = Object.freeze({
    neutral: { motion: "idle01", expression: "default" },
    smile: { motion: "smile01", expression: "smile01" },
    wink: { motion: "wink01", expression: "wink01" },
    shy: { motion: "shame01", expression: "shame01" },
    surprised: { motion: "surprised01", expression: "surprised01" },
    thinking: { motion: "thinking01", expression: "thinking01" },
    serious: { motion: "serious01", expression: "serious01" },
    sad: { motion: "sad01", expression: "sad01" },
    angry: { motion: "angry01", expression: "angry01" },
    wave: { motion: "bye01", expression: "smile01" },
    cheer: { motion: "kandou01", expression: "smile01" },
    cry: { motion: "cry01", expression: "cry01" },
    pose: { motion: "kime01", expression: "smile01" },
  });
  const stem = (name) => String(name).replace(/\.(?:mtn|motion3\.json)$/, "");
  const motionIndex = (costume, name) => costume?.motions?.findIndex((item) => stem(item) === name) ?? -1;
  const semantic = (request) => {
    if (Object.hasOwn(defaults, request.emotion)) return request.emotion;
    return Object.keys(defaults).find((key) => request.motion
      ? defaults[key].motion === request.motion
      : request.expression && defaults[key].expression === request.expression);
  };
  function resolve(costume, request = {}) {
    if (!costume || !Array.isArray(costume.motions) || !Array.isArray(costume.expressions)) return null;
    // 舞台演奏模型没有独立表情文件；仅此能力模式允许真实动作搭配空表情。
    const motionOnly = costume.mode === "performance" && costume.expressions.length === 0;
    if (request.expression === "" && !motionOnly) return null;
    const emotion = semantic(request);
    const mapped = emotion && (costume.reactions?.[emotion] || (!costume.reactions && defaults[emotion]));
    let motion = request.motion;
    let expression = request.expression;
    if (mapped) {
      // 手动表情按钮只切表情；动作按钮同时采用配套表情，避免上一情绪残留。
      motion = request.emotion || request.motion ? mapped.motion : undefined;
      expression = mapped.expression;
    }
    if (expression === "" && !motionOnly) return null;
    if (motionOnly) {
      if (expression) return null;
      expression = "";
    }
    if ((!motion && !expression) || (motion && motionIndex(costume, motion) < 0) || (expression && !costume.expressions.includes(expression))) return null;
    return { emotion, motion, expression, index: motion ? motionIndex(costume, motion) : -1, group: costume.motionGroup || "reaction" };
  }

  // 候选只来自模型实际提供的同类动作；不以增加覆盖率为由混入
  // 其他含义的表演。中性聊天的轻点头单独限定；动作、表情分别筛选。
  // nf/nnf 等用途不明的动作不参与聊天。
  const legacyFamilies = Object.freeze({
    smile: ["smile"], wink: ["wink"], shy: ["shame"], surprised: ["surprised"],
    thinking: ["thinking"], serious: ["serious"], sad: ["sad"], angry: ["angry"],
    wave: ["bye"], cheer: ["kandou"], cry: ["cry"], pose: ["kime"],
  });
  const storyMotionFamilies = Object.freeze({
    smile: ["smile01", "smile02"],
    wink: ["wink01"], shy: ["thinking01"], surprised: ["surprised01", "surprised02"],
    thinking: ["thinking01", "check01", "check02", "question01"],
    serious: ["serious01"],
    sad: ["sad01"], angry: ["angry01"], wave: ["bye01"],
    cheer: ["smile02", "join01"], cry: ["cry01"], pose: ["kime01"],
  });
  const storyExpressionFamilies = Object.freeze({
    smile: ["smile"], wink: ["smile"], shy: ["shy"], surprised: ["surprised"],
    thinking: ["thinking"], serious: ["serious"], sad: ["sad"], angry: ["angry"],
    wave: ["smile"], cheer: ["smile"], cry: ["cry"], pose: ["kime"],
  });
  // 舞台款的动作含自身面部曲线，但没有独立表情。轻奏用于平缓语气，
  // 活跃演奏用于积极语气；这些是舞台回应，不宣称是哭泣/生气专属表情。
  const performanceMotions = Object.freeze({
    smile: ["mtn_play01_02", "mtn_play02_02", "mtn_play02_01", "mtn_play01_01"],
    wink: ["mtn_play02_02", "mtn_action_01", "mtn_play01_02"],
    shy: ["mtn_play01_01", "mtn_play02_01"],
    surprised: ["mtn_action_01", "mtn_play01_03"],
    thinking: ["mtn_play01_01", "mtn_play02_01"],
    serious: ["mtn_play02_01", "mtn_play01_01"],
    sad: ["mtn_play02_01", "mtn_play01_01"],
    angry: ["mtn_play02_01", "mtn_play01_01"],
    wave: ["mtn_finish_01"],
    cheer: ["mtn_play02_03", "mtn_play01_03", "mtn_action_01", "mtn_play02_02"],
    cry: ["mtn_play02_01", "mtn_play01_01"],
    pose: ["mtn_action_01", "mtn_play01_03", "mtn_play02_03"],
  });
  const numbered = (name, prefix, families) => {
    const match = new RegExp(`^${prefix}([a-z]+)(0[1-9])$`).exec(name);
    return !!match && families.includes(match[1]);
  };
  function variants(costume, request = {}) {
    const base = resolve(costume, request);
    if (!base) return [];
    const emotion = base.emotion;
    const chatNeutral = emotion === "neutral" && request.source === "chat" && costume.source === "https://bdon.moe";
    // 初始/清空只用指定待机；手动表情、未知动作仍严格遵循 resolve。
    if (!emotion || (emotion === "neutral" && !chatNeutral) || !base.motion) return [base];
    const results = chatNeutral ? [] : [base];
    const seen = new Set(results.map(choice => `${choice.motion}\n${choice.expression}`));
    const add = (motion, expression) => {
      const index = motionIndex(costume, motion);
      const motionOnly = costume.mode === "performance" && costume.expressions.length === 0;
      if (index < 0 || (expression ? !costume.expressions.includes(expression) : !motionOnly)) return;
      const key = `${motion}\n${expression}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ emotion, motion, expression, index, group: base.group });
    };
    if (chatNeutral) {
      // 普通回应可轻点头或平缓演奏，不把中性语句改成开心、出汗或闭眼。
      if (costume.mode === "performance") {
        for (const motion of ["mtn_play01_01", "mtn_play02_01"]) add(motion, "");
      } else if (costume.mode === "story") {
        for (const side of ["C", "L", "R"]) add(`mtn_nod01_${side}`, "exp_idle01");
      }
      return results.length ? results : [base];
    }
    if (costume.mode === "performance") {
      for (const motion of performanceMotions[emotion] || []) add(motion, "");
      return results;
    }
    const available = costume.motions.map(stem);
    const isStory = available.some(name => /^mtn_[a-z]+\d{2}_[CLR]$/.test(name));
    let motions;
    let expressions;
    if (isStory) {
      motions = (storyMotionFamilies[emotion] || []).flatMap(family =>
        ["C", "L", "R"].map(side => `mtn_${family}_${side}`)).filter(name => available.includes(name));
      expressions = costume.expressions.filter(name => numbered(name, "exp_", storyExpressionFamilies[emotion] || [])).sort();
    } else {
      const families = legacyFamilies[emotion] || [];
      motions = available.filter(name => numbered(name, "", families)).sort();
      expressions = costume.expressions.filter(name => numbered(name, "", families)).sort();
    }
    // 平衡配对覆盖不同动作与同语气表情，不生成全笛卡尔积。旧版同编号
    // 动作优先搭配同编号表情；Our Notes 的方向动作轮流搭配同语气表情。
    if (base.expression) expressions = [base.expression, ...expressions.filter(name => name !== base.expression)];
    if (!expressions.length) return results;
    const orderedMotions = [base.motion, ...motions.filter(name => name !== base.motion)];
    for (let i = 1; i < orderedMotions.length; i++) {
      const motion = orderedMotions[i];
      add(motion, !isStory && expressions.includes(motion) ? motion : expressions[i % expressions.length]);
    }
    const usedExpressions = new Set(results.map(choice => choice.expression));
    let nextMotion = 0;
    for (const expression of expressions) {
      if (!usedExpressions.has(expression)) {
        const matching = !isStory && orderedMotions.includes(expression) ? expression : orderedMotions[nextMotion++ % orderedMotions.length];
        add(matching, expression);
      }
    }
    return results;
  }
  return { defaults, stem, motionIndex, resolve, variants };
});
