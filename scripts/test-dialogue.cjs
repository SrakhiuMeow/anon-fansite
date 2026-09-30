/* 无依赖：node scripts/test-dialogue.cjs */
const assert = require("node:assert/strict");
const { normalize, reply } = require("../assets/js/anon-dialogue.js");
for (const text of ["", "   ", null, undefined]) assert.equal(reply(text), null);
assert.equal(normalize("x".repeat(500)).length, 200);
assert.equal(reply("你好爱音").motion, "bye01");
assert.equal(reply("爱音好可爱").motion, "shame01");
assert.equal(reply("聊聊吉他").motion, "serious01");
assert.match(reply("生日是哪天").text, /9 月 8 日/);
assert.equal(reply("晚安拜拜").motion, "bye01");
assert.equal(reply("眨眼").motion, "wink01");
assert.equal(reply("微笑").expression, "smile01");
assert.equal(reply("别生气").motion, "idle01");
assert.equal(reply("不要哭").expression, "default");
assert.equal(reply("我不开心，鼓励我吧").motion, "kandou01");
assert.notEqual(reply("我不喜欢你").motion, "shame01");
assert.equal(reply("ＨＥＬＬＯ").motion, "bye01");
assert.equal(reply("<img src=x onerror=alert(1)>").motion, "thinking01");
// 每个规则目标都须在三套真实模型中存在，且待机不能随机抽取情绪动作。
const fs = require("node:fs");
const path = require("node:path");
const cases = ["你好", "夸夸", "鼓励", "吉他", "生日", "再见", "微笑", "眨眼", "挥手", "害羞", "惊讶", "生气", "哭泣", "思考", "pose", "默认", "不要哭", "其他"];
for (const costume of ["037_casual-2023", "037_school_winter-2023", "037_school_summer-2023"]) {
  const base = path.join(__dirname, "..", "assets", "live2d", costume);
  const model = JSON.parse(fs.readFileSync(path.join(base, "model.json"), "utf8"));
  assert.deepEqual(model.motions.idle.map((entry) => entry.file), ["motions/idle01.mtn"]);
  for (const text of cases) {
    const result = reply(text);
    assert.ok(model.motions.reaction.some((entry) => entry.file === `motions/${result.motion}.mtn`), `${costume}: ${result.motion}`);
    assert.ok(model.expressions.some((entry) => entry.name === result.expression), `${costume}: ${result.expression}`);
  }
  for (const file of [model.model, ...model.textures, model.physics, ...model.motions.reaction.map((entry) => entry.file), ...model.expressions.map((entry) => entry.file)]) {
    assert.ok(fs.existsSync(path.join(base, file)), `资源缺失：${costume}/${file}`);
  }
}
console.log("对话规则、否定语义、三套真实模型资源与待机分组验证通过。");
