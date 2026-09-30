"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const actions = require("../assets/js/live2d-actions.js");
const root = path.resolve(__dirname, "..");
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "assets/data/anon-live2d.js"), "utf8"), context);
const costumes = context.window.ANON_LIVE2D.costumes;
const coverage = new Map();
const neutralChatModels = { story: 0, performance: 0 };
for (const costume of costumes) {
  const filename = path.join(root, costume.modelJson);
  const model = JSON.parse(fs.readFileSync(filename, "utf8"));
  const groups = model.FileReferences?.Motions || model.motions;
  const expressions = model.FileReferences?.Expressions || model.expressions || [];
  const group = costume.motionGroup || "reaction";
  assert.equal(groups[group].length, costume.motions.length, `${costume.id}: 全部动作索引必须与清单一致`);
  for (const [index, name] of costume.motions.entries()) {
    const entry = groups[group][index];
    const file = entry.File || entry.file;
    assert.equal(actions.stem(path.basename(file)), actions.stem(name), `${costume.id}: ${name} 索引指向错误动作`);
    assert.ok(fs.existsSync(path.join(path.dirname(filename), file)), `${costume.id}: ${name} 动作文件不存在`);
  }
  assert.deepEqual(expressions.map((entry) => entry.Name || entry.name).sort(), Array.from(costume.expressions).sort(), `${costume.id}: 独立表情清单必须与真实文件一致`);
  for (const entry of expressions) assert.ok(fs.existsSync(path.join(path.dirname(filename), entry.File || entry.file)));
  for (const [emotion, legacy] of Object.entries(actions.defaults)) {
    const choice = actions.resolve(costume, { emotion });
    assert.ok(choice, `${costume.id}: ${emotion} 必须有真实动作`);
    if (choice.motion) {
      const entry = groups[choice.group][choice.index];
      const file = entry.File || entry.file;
      assert.equal(actions.stem(path.basename(file)), choice.motion);
      assert.ok(fs.existsSync(path.join(path.dirname(filename), file)));
    }
    if (choice.expression) assert.ok(expressions.some((entry) => (entry.Name || entry.name) === choice.expression));
    else assert.equal(costume.mode, "performance", `${costume.id}: 剧情情绪不能省略表情`);
    assert.deepEqual(actions.resolve(costume, legacy), choice, `${costume.id}: 旧版互动也必须使用该服装的映射`);
    const variants = actions.variants(costume, { emotion });
    assert.deepEqual(variants[0], choice, `${costume.id}: 默认动作必须是候选首项`);
    assert.equal(new Set(variants.map(v => `${v.motion}\n${v.expression}`)).size, variants.length, "候选动作/表情组合必须去重");
    for (const variant of variants) {
      assert.equal(variant.emotion, emotion);
      assert.equal(variant.group, group);
      assert.ok(variant.index >= 0 && variant.index < costume.motions.length);
      assert.equal(actions.stem(costume.motions[variant.index]), variant.motion, "候选索引必须绑定真实动作");
      if (variant.expression) assert.ok(costume.expressions.includes(variant.expression));
      else assert.equal(costume.mode, "performance");
      if (emotion !== "neutral") assert.ok(!/idle/.test(variant.motion), "聊天候选不得混入待机导致看似未回应");
      assert.ok(!/^(?:n?nf)/.test(variant.motion), "用途不明的旧版动作不能参与聊天");
      if (["smile", "wink", "cheer", "wave", "pose"].includes(emotion)) {
        assert.ok(!/angry|cry|sad|pale|shadow|spin/.test(`${variant.motion} ${variant.expression}`), "积极语气不能抽到负面动作/表情");
      }
      if (costume.mode !== "performance" && ["angry", "sad", "cry"].includes(emotion)) {
        assert.ok(new RegExp(`^(?:mtn_)?${emotion}0[1-9](?:_[CLR])?$`).test(variant.motion), "负面动作保持对应语义");
        assert.ok(new RegExp(`^(?:exp_)?${emotion}0[1-9]$`).test(variant.expression), "负面表情保持对应语义");
      }
      if (costume.mode !== "performance" && ["thinking", "serious", "shy"].includes(emotion)) {
        assert.ok(!/smile|wink|kandou|kime|join|bye|angry|cry|sad/.test(`${variant.motion} ${variant.expression}`), "斟酌、认真、害羞都不能因轮换而回到笑脸或相反语气");
      }
      if (costume.mode !== "performance" && costume.format === "cubism4") {
        const motionFamilies = { smile: "smile", serious: "serious", shy: "thinking", pose: "kime" };
        const expressionFamilies = { smile: "smile", serious: "serious", shy: "shy", pose: "kime" };
        if (motionFamilies[emotion]) {
          assert.match(variant.motion, new RegExp(`^mtn_${motionFamilies[emotion]}0[1-9]_[CLR]$`), "动作独立满足当前语义，不用相邻语义凑覆盖率");
          assert.match(variant.expression, new RegExp(`^exp_${expressionFamilies[emotion]}0[1-9]$`), "表情独立满足当前语义，与动作同等参与筛选");
        }
      }
    }
    if (emotion === "neutral") {
      assert.equal(variants.length, 1, "初始和清空的待机不能轮换");
      assert.deepEqual(actions.variants(costume, { emotion, source: "control" }), [choice], "控制操作保持唯一待机");
      const chatVariants = actions.variants(costume, { emotion, source: "chat" });
      if (costume.source === "https://bdon.moe") {
        neutralChatModels[costume.mode]++;
        const performance = costume.mode === "performance";
        const expectedMotions = performance ? ["mtn_play01_01", "mtn_play02_01"] : ["mtn_nod01_C", "mtn_nod01_L", "mtn_nod01_R"];
        assert.deepEqual(chatVariants.map(item => item.motion), expectedMotions, `${costume.id}: 中性聊天只用轻点头或平缓演奏`);
        for (const variant of chatVariants) {
          assert.equal(variant.emotion, "neutral", "有动作回应仍保持中性语义");
          assert.notEqual(variant.motion, choice.motion, "中性聊天不只播放待机");
          assert.equal(variant.expression, performance ? "" : "exp_idle01", "中性聊天不能附加开心、汗滴或闭眼表情");
          assert.equal(actions.stem(costume.motions[variant.index]), variant.motion);
          const motionFile = groups[variant.group][variant.index].File;
          assert.ok(fs.existsSync(path.join(path.dirname(filename), motionFile)), "候选必须来自真实素材");
          const motion = JSON.parse(fs.readFileSync(path.join(path.dirname(filename), motionFile), "utf8"));
          assert.equal(motion.Meta.Loop, false, "中性聊天动作应能正常结束并衔接下一段");
          assert.ok(motion.Meta.Duration > 0 && motion.Curves.length > 0);
        }
      } else {
        assert.deepEqual(chatVariants, [choice], "Bestdori 中性映射保持不变");
      }
      assert.deepEqual(actions.resolve(costume, { emotion, source: "chat" }), choice, "聊天候选不改写基础映射");
    } else {
      assert.deepEqual(actions.variants(costume, { emotion, source: "chat" }), variants, "其他语义候选保持不变");
    }
  }
  const before = new Set(Object.keys(actions.defaults).map(emotion => actions.resolve(costume, { emotion }).motion));
  const after = new Set([...before, ...Object.keys(actions.defaults).flatMap(emotion => actions.variants(costume, { emotion, source: "chat" }).map(v => v.motion))]);
  const beforeExpressions = new Set(Object.keys(actions.defaults).map(emotion => actions.resolve(costume, { emotion }).expression).filter(Boolean));
  const afterExpressions = new Set(Object.keys(actions.defaults).flatMap(emotion => actions.variants(costume, { emotion }).map(v => v.expression)).filter(Boolean));
  const format = costume.mode === "performance" ? "舞台" : costume.format === "cubism4" ? "Our Notes剧情" : "Bestdori";
  coverage.set(format, `动作${before.size}→${after.size}/${costume.motions.length}，表情${beforeExpressions.size}→${afterExpressions.size}/${costume.expressions.length}`);
  assert.ok(after.size > before.size, `${costume.id}: 聊天候选应实际扩大动作覆盖`);
  if (costume.mode !== "performance") {
    assert.ok(afterExpressions.size > beforeExpressions.size, `${costume.id}: 聊天候选应实际扩大独立表情覆盖`);
    const expectedFamilies = costume.format === "cubism4"
      ? { smile: "smile", shy: "shy", thinking: "thinking", serious: "serious", sad: "sad", angry: "angry", cry: "cry" }
      : { smile: "smile", shy: "shame", thinking: "thinking", serious: "serious", sad: "sad", angry: "angry", cry: "cry" };
    for (const [emotion, family] of Object.entries(expectedFamilies)) {
      const prefix = costume.format === "cubism4" ? "exp_" : "";
      const expected = costume.expressions.filter(name => new RegExp(`^${prefix}${family}0[1-9]$`).test(name));
      const actual = new Set(actions.variants(costume, { emotion }).map(v => v.expression));
      for (const expression of expected) assert.ok(actual.has(expression), `${costume.id}: ${emotion} 应覆盖真实同语气表情 ${expression}`);
    }
  }
  assert.equal(groups.idle.length, 1, `${costume.id}: 待机组不能随机播放情绪`);
  assert.equal(actions.resolve(costume, { motion: "nonexistent", expression: "nonexistent" }), null);
  assert.equal(actions.resolve(costume, { emotion: "__proto__" }), null);
  if (costume.mode === "performance") {
    assert.equal(expressions.length, 0, `${costume.id}: 演奏模型不得虚构独立表情`);
    assert.equal(costume.defaultExpression, "");
    assert.equal(costume.performanceActions.length, 9, `${costume.id}: 演奏按钮应列出9个真实动作`);
    assert.equal(new Set(costume.performanceActions.map((item) => item.motion)).size, 9);
    for (const action of costume.performanceActions) {
      assert.ok(typeof action.label === "string" && action.label.trim(), `${costume.id}: 演奏动作需要可读名称`);
      const choice = actions.resolve(costume, { motion: action.motion });
      assert.ok(choice, `${costume.id}: ${action.motion} 应可独立播放`);
      assert.equal(choice.motion, action.motion);
      assert.equal(choice.expression, "");
    }
    for (const emotion of Object.keys(actions.defaults)) {
      const choice = actions.resolve(costume, { emotion });
      if (emotion === "neutral") assert.equal(choice.motion, costume.defaultMotion, `${costume.id}: 初始化和停止应回到待机`);
      else assert.notEqual(choice.motion, costume.defaultMotion, `${costume.id}: 普通对话语气应驱动真实演奏，不依赖动作关键词`);
      assert.equal(choice.expression, "");
      const motionFile = groups[choice.group][choice.index].File;
      const motion = JSON.parse(fs.readFileSync(path.join(path.dirname(filename), motionFile), "utf8"));
      if (emotion !== "neutral") {
        assert.equal(motion.Meta.Loop, false, `${costume.id}: 演奏动作播完后应能自动回待机`);
        assert.ok(motion.Meta.Duration > 0 && motion.Curves.length > 0, "映射必须指向真实有时长、有曲线的动作");
      }
    }
    const positive = ["smile", "wink", "cheer"].map(emotion => actions.resolve(costume, { emotion }).motion);
    assert.equal(new Set(positive).size, 3, "日常积极语气使用不同演奏动作，避免全部映射成同一姿态");
    assert.equal(actions.resolve(costume, { motion: "idle01", expression: "default" }).motion, costume.defaultMotion, "清空或停止仍可复位");
    assert.equal(actions.resolve(costume, { expression: "smile01" }), null, "无表情模型不能生成表情按钮");
  } else {
    assert.equal(actions.resolve(costume, { motion: costume.defaultMotion || "idle01", expression: "" }), null, `${costume.id}: 剧情模型不能接受空表情`);
    const invalid = { ...costume, reactions: { ...costume.reactions, smile: { motion: costume.defaultMotion || "idle01", expression: "" } } };
    assert.equal(actions.resolve(invalid, { emotion: "smile" }), null, `${costume.id}: 剧情模型不能接受空表情映射`);
    const expressionOnly = { expression: "smile01" };
    assert.deepEqual(actions.variants(costume, expressionOnly), [actions.resolve(costume, expressionOnly)], "只切表情不应附加动作");
  }
}
assert.deepEqual(neutralChatModels, { story: 8, performance: 1 }, "覆盖 bdon 全部8套剧情和1套演奏模型的中性聊天");
for (const mode of ["story", "performance"]) {
  const full = costumes.find(costume => costume.source === "https://bdon.moe" && costume.mode === mode);
  const base = actions.resolve(full, { emotion: "neutral" });
  const onlyIdle = { ...full, motions: full.motions.filter(name => actions.stem(name) === base.motion) };
  assert.deepEqual(actions.variants(onlyIdle, { emotion: "neutral", source: "chat" }), [actions.resolve(onlyIdle, { emotion: "neutral" })], "没有轻动作时回退真实待机");
  const firstMotion = mode === "story" ? "mtn_nod01_C" : "mtn_play01_01";
  const partial = { ...full, motions: full.motions.filter(name => [base.motion, firstMotion].includes(actions.stem(name))) };
  assert.deepEqual(actions.variants(partial, { emotion: "neutral", source: "chat" }).map(item => item.motion), [firstMotion], "部分缺失时只使用存在的中性动作");
  const manual = { motion: firstMotion, expression: base.expression, source: "control" };
  assert.deepEqual(actions.variants(full, manual), [actions.resolve(full, manual)], "手动中性动作不加入自动轮换");
  if (mode === "story") {
    const missingNeutralExpression = { ...full, expressions: ["exp_idle02"], reactions: { ...full.reactions, neutral: { ...full.reactions.neutral, expression: "exp_idle02" } } };
    assert.deepEqual(actions.variants(missingNeutralExpression, { emotion: "neutral", source: "chat" }), [actions.resolve(missingNeutralExpression, { emotion: "neutral" })], "没有中性表情时不将汗滴表情配给聊天轻动作");
  }
}

// 只有明确声明无独立表情能力的演奏模型允许空表情，不能靠缺少文件绕过校验。
const performance = { mode: "performance", motions: ["mtn_idle_01.motion3.json", "mtn_play01_01.motion3.json"], expressions: [], reactions: { smile: { motion: "mtn_idle_01", expression: "" } }, motionGroup: "reaction" };
assert.deepEqual(actions.resolve(performance, { motion: "mtn_play01_01" }), { emotion: undefined, motion: "mtn_play01_01", expression: "", index: 1, group: "reaction" });
assert.equal(actions.resolve({ ...performance, mode: "story" }, { emotion: "smile" }), null);
assert.equal(actions.resolve(performance, { motion: "mtn_play01_01", expression: "fake" }), null);
assert.equal(actions.resolve(performance, { expression: "" }), null);
assert.deepEqual(actions.variants(performance, { motion: "mtn_play01_01" }), [actions.resolve(performance, { motion: "mtn_play01_01" })], "手动原始动作名不得被替换");
assert.deepEqual(actions.variants(null, { emotion: "smile" }), []);
assert.deepEqual(actions.variants(costumes[0], { emotion: "__proto__" }), []);
const sparse = { motions: ["smile01.mtn", "smile04.mtn"], expressions: ["smile01", "smile04"] };
const sparseVariants = actions.variants(sparse, { emotion: "smile" });
assert.deepEqual([...new Set(sparseVariants.map(v => v.motion))], ["smile01", "smile04"], "候选必须过滤此服装缺少的动作");
assert.ok(sparseVariants.every(v => ["smile01", "smile04"].includes(v.expression)), "候选必须过滤此服装缺少的表情");
console.log(`Live2D 语义映射验证通过：${costumes.length} 套模型，13种语义、旧版互动、完整动作文件索引及无独立表情的演奏模型；bdon 中性聊天覆盖8套剧情轻点头和1套平缓演奏，初始化和控制保持待机。`);
console.log(`聊天动作覆盖（固定映射→候选/素材总数）：${[...coverage].map(([format, counts]) => `${format} ${counts}`).join("；")}。`);
