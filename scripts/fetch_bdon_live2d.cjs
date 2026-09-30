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
const SELECTED = [
  ["adv_live2d_anon_002_casual_spring_01_glasses", "Our Notes · 私服（眼镜）"],
  ["adv_live2d_anon_002_live_01", "Our Notes · 演出服"],
  ["adv_live2d_anon_002_roomwear_01_glasses", "Our Notes · 居家服（眼镜）"],
];
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

function download(url) {
  assert(url.startsWith(SITE + "/") || url.startsWith(CHART + "/"), "Unexpected source origin");
  const cached = path.join(CACHE, "downloads", sha256(url));
  if (!fs.existsSync(cached) || (force && !offline)) {
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

function asset(ref, size) {
  assert(/^assets\/[a-f0-9]{64}\.[a-z0-9.]+$/.test(ref), `Unexpected asset path: ${ref}`);
  const raw = download(SITE + "/" + ref);
  const decoded = ref.endsWith(".gz") ? zlib.gunzipSync(raw) : raw;
  assert.equal(decoded.length, size, `Asset size mismatch: ${ref}`);
  assert.equal(sha256(decoded), ref.slice(7, 71), `Asset hash mismatch: ${ref}`);
  return decoded;
}

function readFileEntry(manifest, name) {
  const entry = manifest.files[name];
  assert(entry, `Missing upstream file: ${name}`);
  if (entry.parts) {
    const value = {};
    for (const [key, ref, size] of entry.parts) value[key] = JSON.parse(asset(ref, size));
    return Buffer.from(JSON.stringify(value));
  }
  return asset(entry.asset, entry.size);
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

function buildCostume(index, id, label) {
  assert(index.models.some(m => m.id === id), `Model is no longer indexed: ${id}`);
  const manifestURL = `${SITE}/models/${id}.json`;
  const manifestRaw = download(manifestURL);
  const manifest = JSON.parse(manifestRaw);
  const model = JSON.parse(readFileEntry(manifest, "model.json"));
  const nodes = JSON.parse(readFileEntry(manifest, model.prefab)).nodes;
  const components = nodes[0].components;
  const component = name => {
    const value = components.find(c => c.class === name);
    assert(value, `Required component missing: ${name}`);
    return value;
  };
  const character = component("Live2DCharacter");
  const expressions = component("CubismExpressionController").ExpressionsList.CubismExpressionObjects;
  const motions = component("CubismFadeController").CubismFadeMotionList.CubismFadeMotionObjects;
  const folder = path.join(ROOT, "assets/live2d", "bdon_" + id);
  const moc = readFileEntry(manifest, model.moc3);
  assert.equal(moc.subarray(0, 4).toString(), "MOC3", "Invalid MOC3 magic");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "model.moc3"), moc);
  const textures = model.textures.map((name, i) => {
    const target = `textures/texture_${i}.png`;
    const bytes = readFileEntry(manifest, name);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "Invalid PNG");
    fs.mkdirSync(path.dirname(path.join(folder, target)), { recursive: true });
    fs.writeFileSync(path.join(folder, target), bytes);
    return target;
  });
  const expressionNames = expressions.map(e => e.name.replace(/\.exp3$/, ""));
  const motionNames = motions.map(m => m.name.replace(/\.fade$/, ""));
  expressions.forEach((exp, i) => writeJSON(path.join(folder, `expressions/${expressionNames[i]}.exp3.json`), convertExpression(exp)));
  motions.forEach((motion, i) => writeJSON(path.join(folder, `motions/${motionNames[i]}.motion3.json`),
    convertMotion(motion, motionNames[i] === character.DefaultMotionName)));
  writeJSON(path.join(folder, "model.physics3.json"), convertPhysics(component("CubismPhysicsController")._rig));
  const groups = [
    ["EyeBlink", "CubismEyeBlinkParameter"], ["LipSync", "CubismMouthParameter"],
  ].map(([Name, cls]) => ({ Target: "Parameter", Name,
    Ids: nodes.filter(n => n.components.some(c => c.class === cls)).map(n => n.name) }));
  const fileReference = name => ({ File: `motions/${name}.motion3.json` });
  writeJSON(path.join(folder, "model.model3.json"), { Version: 3,
    FileReferences: { Moc: "model.moc3", Textures: textures, Physics: "model.physics3.json",
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
    manifestURL, manifestSha256: sha256(manifestRaw), sourceModelId: id, mocVersion: model.canvas.mocVersion,
    conversion: "Unity CubismFadeMotionData Hermite curves -> restricted cubic Beziers; CubismExpressionData -> exp3; CubismPhysicsRig -> physics3. Original parameters retained.",
    upstreamFiles: manifest.files, files: generatedFiles });
  const totalBytes = generatedFiles.reduce((n, f) => n + f.bytes, 0);
  console.log(`${label}: ${motionNames.length} motions, ${expressionNames.length} expressions, ${(totalBytes / 1048576).toFixed(1)} MiB`);
  return { id: "bdon_" + id, label, format: "cubism4", source: "https://bdon.moe",
    sourceUrl: "https://bdon.moe/tools/live2d?model=" + id, sourceModelId: id,
    modelJson: posix(path.relative(ROOT, path.join(folder, "model.model3.json"))),
    motionGroup: "reaction", motionExtension: ".motion3.json", defaultMotion: character.DefaultMotionName,
    defaultExpression: character.DefaultExpressionName, motionCount: motionNames.length,
    expressionCount: expressionNames.length, motions: motionNames.map(n => n + ".motion3.json"),
    expressions: expressionNames, reactions, bytes: totalBytes };
}

function main() {
  const index = JSON.parse(download(`${SITE}/models.json`));
  const costumes = SELECTED.map(([id, label]) => buildCostume(index, id, label));
  const current = fs.readFileSync(OUTPUT, "utf8");
  const payload = JSON.parse(current.slice(current.indexOf("{"), current.lastIndexOf("}") + 1));
  payload.sources = ["https://bestdori.com", "https://bdon.moe"];
  payload.generatedAt = new Date().toISOString();
  payload.costumes = [...payload.costumes.filter(c => !SELECTED.some(([id]) => c.id === "bdon_" + id)), ...costumes];
  fs.writeFileSync(OUTPUT, "/* 由 scripts/fetch_live2d.py 与 scripts/fetch_bdon_live2d.cjs 生成。来源：Bestdori / bdon.moe */\nwindow.ANON_LIVE2D = " + JSON.stringify(payload, null, 2) + ";\n");
  console.log(`Total costumes: ${payload.costumes.length}; originals retained.`);
}

if (require.main === module) main();
module.exports = { convertMotion, convertExpression, convertPhysics };
