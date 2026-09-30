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
  const expressions = model.FileReferences?.Expressions || model.expressions;
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
    assert.deepEqual(actions.resolve(costume, legacy), choice, `${costume.id}: 旧版互动也必须使用该服装的映射`);
  }
  assert.equal(groups.idle.length, 1, `${costume.id}: 待机组不能随机播放情绪`);
  assert.equal(actions.resolve(costume, { motion: "nonexistent", expression: "nonexistent" }), null);
  assert.equal(actions.resolve(costume, { emotion: "__proto__" }), null);
}
console.log(`Live2D 语义映射验证通过：${costumes.length} 套模型，13种语义、旧版互动兼容及真实文件索引。`);
