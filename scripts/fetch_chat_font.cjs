#!/usr/bin/env node
"use strict";

// 固定版本、校验发布哈希；仅维护时运行，网站部署与访问均不依赖外部字体服务。
// node scripts/fetch_chat_font.cjs
// 可选代理：FONT_DOWNLOAD_PROXY=http://127.0.0.1:7897
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const version = "5.3.0";
const base = `https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@${version}`;
const directory = path.resolve(__dirname, "../assets/fonts/noto-sans-sc");
const hash = (buffer) => createHash("sha256").update(buffer).digest("base64");

async function download(url) {
  const args = ["--fail", "--location", "--silent", "--show-error", "--retry", "2", "--connect-timeout", "20", "--max-time", "120"];
  if (process.env.FONT_DOWNLOAD_PROXY) args.push("--proxy", process.env.FONT_DOWNLOAD_PROXY);
  args.push(url);
  return (await run(process.platform === "win32" ? "curl.exe" : "curl", args, { encoding: "buffer", maxBuffer: 4 * 1024 * 1024, windowsHide: true })).stdout;
}

(async () => {
  const [listing, stylesheet, license] = await Promise.all([
    download(`https://data.jsdelivr.com/v1/package/npm/@fontsource/noto-sans-sc@${version}/flat`),
    download(`${base}/700.css`),
    download(`${base}/LICENSE`),
  ]);
  const entries = new Map(JSON.parse(listing).files.map((entry) => [entry.name, entry]));
  for (const [name, buffer] of [["/700.css", stylesheet], ["/LICENSE", license]]) {
    if (hash(buffer) !== entries.get(name)?.hash) throw new Error(`发布文件哈希不符：${name}`);
  }
  const originalCss = stylesheet.toString("utf8");
  const files = [...new Set([...originalCss.matchAll(/url\(\.\/files\/(noto-sans-sc-[\w-]+-700-normal\.woff2)\)/g)].map((match) => match[1]))];
  if (!files.length) throw new Error("未找到700字重的woff2文件");
  fs.mkdirSync(path.join(directory, "files"), { recursive: true });
  let index = 0;
  const manifest = [];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (index < files.length) {
      const name = files[index++];
      const entry = entries.get(`/files/${name}`);
      if (!entry) throw new Error(`发布清单缺少：${name}`);
      const target = path.join(directory, "files", name);
      let buffer = fs.existsSync(target) ? fs.readFileSync(target) : null;
      if (!buffer || hash(buffer) !== entry.hash) buffer = await download(`${base}/files/${name}`);
      if (buffer.length !== entry.size || hash(buffer) !== entry.hash || buffer.toString("ascii", 0, 4) !== "wOF2") throw new Error(`字体校验失败：${name}`);
      fs.writeFileSync(target, buffer);
      manifest.push({ file: `files/${name}`, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") });
    }
  }));
  // 仅改变CSS家族别名与删除不使用的woff后备地址；字体文件原样保存。
  const css = `/* Noto Sans SC 700 — @fontsource/noto-sans-sc ${version}\n * Original font files: SIL Open Font License 1.1; see LICENSE.\n * Self-hosted files; unicode-range keeps downloads limited to displayed characters.\n */\n` + originalCss
    .replaceAll("font-family: 'Noto Sans SC';", "font-family: 'Anon Chat Sans';")
    .replace(/, url\(\.\/files\/[^)]+\.woff\) format\('woff'\)/g, "");
  fs.writeFileSync(path.join(directory, "700.css"), css);
  fs.writeFileSync(path.join(directory, "LICENSE"), license);
  manifest.sort((left, right) => left.file.localeCompare(right.file));
  fs.writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify({ package: "@fontsource/noto-sans-sc", version, weight: 700, source: base, license: "OFL-1.1", files: manifest }, null, 2)}\n`);
  console.log(`聊天字体已校验并自托管：${manifest.length} 个woff2分段，${manifest.reduce((sum, item) => sum + item.bytes, 0)} 字节。`);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
