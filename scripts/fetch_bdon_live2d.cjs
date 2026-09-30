#!/usr/bin/env node
"use strict";

// 下载 bdon.moe 公开索引中的爱音模型，将 Unity 数据独立转换为标准 Cubism JSON。
// 不依赖 bdon 的播放器代码。原始缓存留在被 Git 忽略的 /data/bdon/。
// node scripts/fetch_bdon_live2d.cjs --proxy http://127.0.0.1:7897
// node scripts/fetch_bdon_live2d.cjs --offline  # 使用缓存重新转换
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const CACHE = path.join(ROOT, "data/bdon");
const SITE = "https://storage.bdon.moe/moenotes";
const CHART = "https://assets.bdon.moe/chart-site";
const OUTPUT = path.join(ROOT, "assets/data/anon-live2d.js");
const LABELS = new Map([
  ["adv_live2d_anon_002_casual_spring_01", "Our Notes · 私服（春）"],
  ["adv_live2d_anon_002_casual_spring_01_glasses", "Our Notes · 私服（眼镜）"],
  ["adv_live2d_anon_002_live_01", "Our Notes · 演出服"],
  ["adv_live2d_anon_002_roomwear_01_glasses", "Our Notes · 居家服（眼镜）"],
  ["adv_live2d_anon_002_roomwear_01", "Our Notes · 居家服"],
  ["adv_live2d_anon_002_school_summer_hs_1st", "Our Notes · 制服（夏）"],
  ["adv_live2d_anon_002_school_winter_hs_1st", "Our Notes · 制服（冬）"],
  ["adv_live2d_anon_002_school_winter_hs_1st_glasses", "Our Notes · 制服（冬·眼镜）"],
  ["live2d_anon_002_live_01", "Our Notes · 吉他演奏（舞台）"],
]);
const PERFORMANCE_LABELS = {
  mtn_idle_01: "舞台待机", mtn_action_01: "舞台动作", mtn_finish_01: "演奏收尾",
  mtn_play01_01: "演奏一 · 1", mtn_play01_02: "演奏一 · 2", mtn_play01_03: "演奏一 · 3",
  mtn_play02_01: "演奏二 · 1", mtn_play02_02: "演奏二 · 2", mtn_play02_03: "演奏二 · 3",
};
// 舞台动作本身包含身体、吉他和部分脸部曲线，不依赖聊天中的动作关键词。
// 这是语气到真实演奏动作的映射，不将它们冒充独立表情。
const PERFORMANCE_REACTIONS = {
  neutral: "mtn_idle_01", smile: "mtn_play01_02", wink: "mtn_play02_02",
  shy: "mtn_play01_01", surprised: "mtn_action_01", thinking: "mtn_play01_01",
  serious: "mtn_play02_01", sad: "mtn_play02_01", angry: "mtn_play02_01",
  wave: "mtn_finish_01", cheer: "mtn_play02_03", cry: "mtn_play02_01", pose: "mtn_action_01",
};
const args = process.argv.slice(2);
const proxyIndex = args.indexOf("--proxy");
const proxy = proxyIndex >= 0 ? args[proxyIndex + 1] : process.env.HTTPS_PROXY;
const offline = args.includes("--offline");
const force = args.includes("--force");
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const posix = value => value.split(path.sep).join("/");
const writeJSON = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
};

function download(url, refresh = false) {
  assert(url.startsWith(SITE + "/") || url.startsWith(CHART + "/"), "Unexpected source origin");
  const cached = path.join(CACHE, "downloads", sha256(url));
  if (!fs.existsSync(cached) || ((force || refresh) && !offline)) {
    assert(!offline, `Offline cache missing: ${url}`);
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    const tmp = cached + ".part";
    const curlArgs = ["--location", "--fail", "--silent", "--show-error", "--retry", "2", "--max-time", "90", "--output", tmp];
    if (proxy) curlArgs.push("--proxy", proxy);
    execFileSync(process.platform === "win32" ? "curl.exe" : "curl", [...curlArgs, url], { stdio: "inherit" });
    fs.renameSync(tmp, cached);
  }
  return fs.readFileSync(cached);
}

function asset(base, ref, size) {
  assert(/^assets\/[a-f0-9]{64}\.[a-z0-9.]+$/.test(ref), `Unexpected asset path: ${ref}`);
  const raw = download(base + "/" + ref);
  const decoded = ref.endsWith(".gz") ? zlib.gunzipSync(raw) : raw;
  assert.equal(decoded.length, size, `Asset size mismatch: ${ref}`);
  assert.equal(sha256(decoded), ref.slice(7, 71), `Asset hash mismatch: ${ref}`);
  return decoded;
}

function readFileEntry(base, manifest, name) {
  const entry = manifest.files[name];
  assert(entry, `Missing upstream file: ${name}`);
  if (entry.parts) {
    const value = {};
    for (const [key, ref, size] of entry.parts) value[key] = JSON.parse(asset(base, ref, size));
    return Buffer.from(JSON.stringify(value));
  }
  return asset(base, entry.asset, entry.size);
}

// 两个公开索引都要查询；名称只是角色名，不能用它判断是否同一服装。
// 相同 ID 优先使用剧情源；有标准版时排除同款 _low 画质副本。
function selectModels(catalogs) {
  const merged = new Map();
  for (const { base, index } of catalogs) {
    assert([SITE, CHART].includes(base), "Unexpected catalog origin");
    assert(Array.isArray(index.models), "Invalid model catalog");
    for (const entry of index.models) {
      if (!/^(?:adv_)?live2d_anon_002_[a-z0-9_]+$/.test(entry.id)) continue;
      if (!merged.has(entry.id)) merged.set(entry.id, { ...entry, base, catalogUrls: [] });
      merged.get(entry.id).catalogUrls.push(`${base}/models.json`);
    }
  }
  const selected = [], excluded = [];
  for (const [id, entry] of merged) {
    const standardId = id.replace(/_low$/, "");
    if (standardId !== id && merged.has(standardId)) {
      excluded.push({ id, equivalentId: standardId, reason: "同款低清副本，保留标准画质版" });
    } else {
      selected.push({ ...entry, label: LABELS.get(id) || `Our Notes · ${id.replace(/^(?:adv_)?live2d_anon_002_/, "")}` });
    }
  }
  selected.sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(new Set(selected.map(m => m.label)).size, selected.length, "Duplicate outfit labels");
  assert(selected.length > 0, "No Anon models found");
  return { selected, excluded };
}

// Unity unweighted Hermite keys -> Cubism cubic Bezier segments. Tangents are preserved,
// not replaced with straight lines. Weighted curves fail closed until explicitly supported.
function convertMotion(input, loop) {
  let segmentCount = 0;
  let pointCount = 0;
  const Curves = input.ParameterIds.map((Id, i) => {
    const keys = input.ParameterCurves[i].m_Curve;
    assert(keys.length > 0, `Empty motion curve: ${Id}`);
    const Segments = [keys[0].time, keys[0].value];
    pointCount++;
    for (let k = 1; k < keys.length; k++) {
      const a = keys[k - 1], b = keys[k];
      assert.equal(a.weightedMode || 0, 0, "Weighted animation curve is not supported");
      assert.equal(b.weightedMode || 0, 0, "Weighted animation curve is not supported");
      assert(b.time > a.time, "Non-increasing animation time");
      const dt = (b.time - a.time) / 3;
      assert(Number.isFinite(a.outSlope) && Number.isFinite(b.inSlope), "Non-finite animation tangent");
      Segments.push(1, a.time + dt, a.value + a.outSlope * dt,
        b.time - dt, b.value - b.inSlope * dt, b.time, b.value);
      segmentCount++;
      pointCount += 3;
    }
    return { Target: "Parameter", Id, FadeInTime: input.ParameterFadeInTimes[i],
      FadeOutTime: input.ParameterFadeOutTimes[i], Segments };
  });
  return { Version: 3, Meta: { Duration: input.MotionLength, Fps: 30, Loop: loop,
    AreBeziersRestricted: true, FadeInTime: input.FadeInTime, FadeOutTime: input.FadeOutTime,
    CurveCount: Curves.length, TotalSegmentCount: segmentCount, TotalPointCount: pointCount,
    UserDataCount: 0, TotalUserDataSize: 0 }, Curves, UserData: [] };
}

function convertExpression(input) {
  const blends = ["Overwrite", "Add", "Multiply"];
  return { Type: "Live2D Expression", FadeInTime: input.FadeInTime, FadeOutTime: input.FadeOutTime,
    Parameters: input.Parameters.map(p => {
      assert(blends[p.Blend], `Unknown expression blend: ${p.Blend}`);
      return { Id: p.Id, Value: p.Value, Blend: blends[p.Blend] };
    }) };
}

function convertPhysics(rig) {
  const type = value => { assert([0, 1, 2].includes(value)); return ["X", "Y", "Angle"][value]; };
  const vector = v => ({ X: v.x, Y: v.y });
  const PhysicsSettings = rig.SubRigs.map((r, i) => ({ Id: `PhysicsSetting${i + 1}`,
    Input: r.Input.map(v => ({ Source: { Target: "Parameter", Id: v.SourceId }, Weight: v.Weight,
      Type: type(v.SourceComponent), Reflect: !!v.IsInverted })),
    Output: r.Output.map(v => ({ Destination: { Target: "Parameter", Id: v.DestinationId },
      VertexIndex: v.ParticleIndex, Scale: v.SourceComponent === 2 ? v.AngleScale
        : v.SourceComponent === 0 ? v.TranslationScale.x : v.TranslationScale.y,
      Weight: v.Weight, Type: type(v.SourceComponent), Reflect: !!v.IsInverted })),
    Vertices: r.Particles.map(v => ({ Position: vector(v.InitialPosition), Mobility: v.Mobility,
      Delay: v.Delay, Acceleration: v.Acceleration, Radius: v.Radius })),
    Normalization: r.Normalization,
  }));
  return { Version: 3, Meta: { PhysicsSettingCount: PhysicsSettings.length,
    TotalInputCount: PhysicsSettings.reduce((n, r) => n + r.Input.length, 0),
    TotalOutputCount: PhysicsSettings.reduce((n, r) => n + r.Output.length, 0),
    VertexCount: PhysicsSettings.reduce((n, r) => n + r.Vertices.length, 0), Fps: rig.Fps,
    EffectiveForces: { Gravity: vector(rig.Gravity), Wind: vector(rig.Wind) },
    PhysicsDictionary: rig.SubRigs.map((r, i) => ({ Id: `PhysicsSetting${i + 1}`, Name: r.Name })) },
    PhysicsSettings };
}

function buildCostume({ base, id, label, catalogUrls }) {
  const manifestURL = `${base}/models/${id}.json`;
  const manifestRaw = download(manifestURL, true);
  const manifest = JSON.parse(manifestRaw);
  const read = name => readFileEntry(base, manifest, name);
  const model = JSON.parse(read("model.json"));
  const nodes = JSON.parse(read(model.prefab)).nodes;
  const components = nodes[0].components;
  const component = name => {
    const value = components.find(c => c.class === name);
    assert(value, `Required component missing: ${name}`);
    return value;
  };
  const character = component("Live2DCharacter");
  const performance = id.startsWith("live2d_");
  const expressions = component("CubismExpressionController").ExpressionsList?.CubismExpressionObjects || [];
  assert(performance || expressions.length > 0, `Story model is missing expressions: ${id}`);
  const motions = component("CubismFadeController").CubismFadeMotionList.CubismFadeMotionObjects;
  const folder = path.join(ROOT, "assets/live2d", "bdon_" + id);
  const moc = read(model.moc3);
  assert.equal(moc.subarray(0, 4).toString(), "MOC3", "Invalid MOC3 magic");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "model.moc3"), moc);
  const textures = model.textures.map((name, i) => {
    const target = `textures/texture_${i}.png`;
    const bytes = read(name);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "Invalid PNG");
    fs.mkdirSync(path.dirname(path.join(folder, target)), { recursive: true });
    fs.writeFileSync(path.join(folder, target), bytes);
    return target;
  });
  const expressionNames = expressions.map(e => e.name.replace(/\.exp3$/, ""));
  const motionNames = motions.map(m => m.name.replace(/\.fade$/, ""));
  assert(motionNames.includes(character.DefaultMotionName), "Missing default motion");
  expressions.forEach((exp, i) => writeJSON(path.join(folder, `expressions/${expressionNames[i]}.exp3.json`), convertExpression(exp)));
  motions.forEach((motion, i) => writeJSON(path.join(folder, `motions/${motionNames[i]}.motion3.json`),
    convertMotion(motion, motionNames[i] === character.DefaultMotionName)));
  const rig = component("CubismPhysicsController")._rig;
  const hasPhysics = rig.SubRigs.length > 0;
  if (hasPhysics) writeJSON(path.join(folder, "model.physics3.json"), convertPhysics(rig));
  const groups = [
    ["EyeBlink", "CubismEyeBlinkParameter"], ["LipSync", "CubismMouthParameter"],
  ].map(([Name, cls]) => ({ Target: "Parameter", Name,
    Ids: nodes.filter(n => n.components.some(c => c.class === cls)).map(n => n.name) }));
  const fileReference = name => ({ File: `motions/${name}.motion3.json` });
  writeJSON(path.join(folder, "model.model3.json"), { Version: 3,
    FileReferences: { Moc: "model.moc3", Textures: textures, ...(hasPhysics ? { Physics: "model.physics3.json" } : {}),
      Expressions: expressionNames.map(Name => ({ Name, File: `expressions/${Name}.exp3.json` })),
      Motions: { idle: [fileReference(character.DefaultMotionName)], reaction: motionNames.map(fileReference) } },
    Groups: groups, HitAreas: [] });
  const pairs = {
    neutral: ["idle01", "idle01"], smile: ["smile01", "smile01"], wink: ["wink01", "smile01"],
    shy: ["thinking01", "shy01"], surprised: ["surprised01", "surprised01"],
    thinking: ["thinking01", "thinking01"], serious: ["serious01", "serious01"],
    sad: ["sad01", "sad01"], angry: ["angry01", "angry01"], wave: ["bye01", "smile01"],
    cheer: ["smile02", "smile02"], cry: ["cry01", "cry01"], pose: ["kime01", "kime01"],
  };
  const reactions = Object.fromEntries(Object.entries(pairs).map(([emotion, [m, e]]) => {
    if (performance) {
      const motion = PERFORMANCE_REACTIONS[emotion];
      assert(motionNames.includes(motion), `Missing mapped stage motion: ${motion}`);
      return [emotion, { motion, expression: "" }];
    }
    const motion = `mtn_${m}_C`, expression = `exp_${e}`;
    assert(motionNames.includes(motion), `Missing mapped motion: ${motion}`);
    assert(expressionNames.includes(expression), `Missing mapped expression: ${expression}`);
    return [emotion, { motion, expression }];
  }));
  const generatedFiles = [];
  function collect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (entry.name !== "source.json") generatedFiles.push({ path: posix(path.relative(folder, full)),
        bytes: fs.statSync(full).size, sha256: sha256(fs.readFileSync(full)) });
    }
  }
  collect(folder);
  writeJSON(path.join(folder, "source.json"), { source: "https://bdon.moe/tools/live2d?model=" + id,
    manifestURL, manifestSha256: sha256(manifestRaw), sourceModelId: id, catalogUrls, mocVersion: model.canvas.mocVersion,
    conversion: "Unity CubismFadeMotionData Hermite curves -> restricted cubic Beziers; CubismExpressionData -> exp3; CubismPhysicsRig -> physics3. Original parameters retained.",
    upstreamFiles: manifest.files, files: generatedFiles });
  const totalBytes = generatedFiles.reduce((n, f) => n + f.bytes, 0);
  console.log(`${label}: ${motionNames.length} motions, ${expressionNames.length} expressions, ${(totalBytes / 1048576).toFixed(1)} MiB`);
  return { id: "bdon_" + id, label, format: "cubism4", source: "https://bdon.moe",
    mode: performance ? "performance" : "story",
    ...(performance ? { performanceActions: motionNames.map(motion => ({ motion, label: PERFORMANCE_LABELS[motion] || motion })) } : {}),
    sourceUrl: "https://bdon.moe/tools/live2d?model=" + id, sourceModelId: id,
    modelJson: posix(path.relative(ROOT, path.join(folder, "model.model3.json"))),
    motionGroup: "reaction", motionExtension: ".motion3.json", defaultMotion: character.DefaultMotionName,
    defaultExpression: character.DefaultExpressionName, motionCount: motionNames.length,
    expressionCount: expressionNames.length, motions: motionNames.map(n => n + ".motion3.json"),
    expressions: expressionNames, reactions, bytes: totalBytes };
}

function main() {
  const catalogs = [SITE, CHART].map(base => ({ base, index: JSON.parse(download(`${base}/models.json`, true)) }));
  const { selected, excluded } = selectModels(catalogs);
  const costumes = selected.map(buildCostume);
  const current = fs.readFileSync(OUTPUT, "utf8");
  const payload = JSON.parse(current.slice(current.indexOf("{"), current.lastIndexOf("}") + 1));
  payload.sources = ["https://bestdori.com", "https://bdon.moe"];
  payload.generatedAt = new Date().toISOString();
  const replaced = new Set([...selected, ...excluded].map(entry => "bdon_" + entry.id));
  payload.costumes = [...payload.costumes.filter(c => !replaced.has(c.id)), ...costumes];
  payload.bdonCatalog = { indexes: catalogs.map(c => `${c.base}/models.json`),
    indexedCount: selected.length + excluded.length, includedIds: selected.map(c => c.id), excluded };
  assert.equal(new Set(payload.costumes.map(c => c.id)).size, payload.costumes.length, "Duplicate model IDs");
  fs.writeFileSync(OUTPUT, "/* 由 scripts/fetch_live2d.py 与 scripts/fetch_bdon_live2d.cjs 生成。来源：Bestdori / bdon.moe */\nwindow.ANON_LIVE2D = " + JSON.stringify(payload, null, 2) + ";\n");
  console.log(`Total costumes: ${payload.costumes.length}; originals retained.`);
}

if (require.main === module) main();
module.exports = { convertMotion, convertExpression, convertPhysics, selectModels };
