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
      assert.equal(choice.motion, "mtn_idle_01", `${costume.id}: 对话情绪不得误触发演奏动作`);
      assert.equal(choice.expression, "");
    }
    assert.equal(actions.resolve(costume, { expression: "smile01" }), null, "无表情模型不能生成表情按钮");
  } else {
    assert.equal(actions.resolve(costume, { motion: costume.defaultMotion || "idle01", expression: "" }), null, `${costume.id}: 剧情模型不能接受空表情`);
    const invalid = { ...costume, reactions: { ...costume.reactions, smile: { motion: costume.defaultMotion || "idle01", expression: "" } } };
    assert.equal(actions.resolve(invalid, { emotion: "smile" }), null, `${costume.id}: 剧情模型不能接受空表情映射`);
  }
}

// 只有明确声明无独立表情能力的演奏模型允许空表情，不能靠缺少文件绕过校验。
const performance = { mode: "performance", motions: ["mtn_idle_01.motion3.json", "mtn_play01_01.motion3.json"], expressions: [], reactions: { smile: { motion: "mtn_idle_01", expression: "" } }, motionGroup: "reaction" };
assert.deepEqual(actions.resolve(performance, { motion: "mtn_play01_01" }), { emotion: undefined, motion: "mtn_play01_01", expression: "", index: 1, group: "reaction" });
assert.equal(actions.resolve({ ...performance, mode: "story" }, { emotion: "smile" }), null);
assert.equal(actions.resolve(performance, { motion: "mtn_play01_01", expression: "fake" }), null);
assert.equal(actions.resolve(performance, { expression: "" }), null);
console.log(`Live2D 语义映射验证通过：${costumes.length} 套模型，13种语义、旧版互动、完整动作文件索引及无独立表情的演奏模型。`);
