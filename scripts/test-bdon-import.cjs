"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const { selectModels } = require("./fetch_bdon_live2d.cjs");
const story = "https://storage.bdon.moe/moenotes";
const chart = "https://assets.bdon.moe/chart-site";
const privateId = "adv_live2d_anon_002_casual_spring_01";
const glassesId = privateId + "_glasses";
const liveId = "live2d_anon_002_live_01";
const model = id => ({ id, label: "千早愛音" });
const catalog = (base, ids) => ({ base, index: { models: ids.map(model) } });
const result = selectModels([
  catalog(story, [privateId, glassesId]),
  catalog(chart, [privateId, glassesId, liveId, liveId + "_low", "live2d_tomori_001_live_01"]),
]);
assert.equal(result.selected.length, 3, "同角色名的不同模型不能被覆盖；跨索引同ID应合并");
assert.equal(result.selected.find(m => m.id === privateId).base, story);
assert.equal(result.selected.find(m => m.id === liveId).base, chart, "不能漏掉chart独有模型");
assert.equal(result.selected.find(m => m.id === privateId).catalogUrls.length, 2);
assert.equal(new Set(result.selected.map(m => m.label)).size, 3);
assert.deepEqual(result.excluded.map(m => [m.id, m.equivalentId]), [[liveId + "_low", liveId]]);
assert.equal(selectModels([catalog(chart, [liveId + "_low"])]).selected.length, 1, "仅有低清时不能丢失唯一可用版本");
assert.equal(selectModels([catalog(chart, ["adv_live2d_anon_002_future_outfit"]) ]).selected.length, 1, "新服装不依赖硬编码白名单");

const root = path.resolve(__dirname, "..");
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "assets/data/anon-live2d.js"), "utf8"), context);
const data = context.window.ANON_LIVE2D;
const bdon = data.costumes.filter(c => c.id.startsWith("bdon_"));
assert.equal(new Set(data.costumes.map(c => c.id)).size, data.costumes.length);
assert.equal(new Set(data.costumes.map(c => c.label)).size, data.costumes.length);
assert.equal(bdon.length, data.bdonCatalog.includedIds.length);
assert.equal(data.bdonCatalog.indexedCount, bdon.length + data.bdonCatalog.excluded.length);
for (const id of data.bdonCatalog.includedIds) assert.ok(bdon.some(c => c.sourceModelId === id));
for (const skipped of data.bdonCatalog.excluded) {
  assert.ok(!bdon.some(c => c.sourceModelId === skipped.id));
  assert.ok(bdon.some(c => c.sourceModelId === skipped.equivalentId));
}
for (const id of ["037_casual-2023", "037_school_winter-2023", "037_school_summer-2023"])
  assert.ok(data.costumes.some(c => c.id === id), `原有模型必须保留: ${id}`);
let files = 0;
for (const costume of bdon) {
  const folder = path.dirname(path.join(root, costume.modelJson));
  const source = JSON.parse(fs.readFileSync(path.join(folder, "source.json"), "utf8"));
  assert.equal(source.sourceModelId, costume.sourceModelId);
  assert.ok(source.manifestURL.endsWith(`/models/${costume.sourceModelId}.json`));
  for (const entry of source.files) {
    const contents = fs.readFileSync(path.join(folder, entry.path));
    assert.equal(contents.length, entry.bytes, entry.path);
    assert.equal(crypto.createHash("sha256").update(contents).digest("hex"), entry.sha256, entry.path);
    files++;
  }
}
console.log(`bdon导入检查通过：双索引合并、服装与画质副本去重、原模型保留、${bdon.length}套/${files}个文件完整性。`);
