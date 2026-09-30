#!/usr/bin/env node
'use strict';

// 零依赖、离线的部署前检查：检查实际文件与公开数据契约，不请求外部网站。
// 用法：node scripts/check-site.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const errors = [];
const checkedFiles = new Set();
const counts = { cards: 0, variants: 0, costumes: 0, products: 0, honors: 0 };
const fail = (message) => errors.push(message);
const check = (condition, message) => { if (!condition) fail(message); return !!condition; };
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const decode = (value) => value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, (entity) => {
  const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
  if (named[entity]) return named[entity];
  const hex = entity.toLowerCase().startsWith('&#x');
  return String.fromCodePoint(parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10));
});
function date(value, label) {
  return check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, `${label} 不是有效日期`);
}
function list(value, label, minimum = 1) {
  if (!check(Array.isArray(value) && value.length >= minimum, `${label} 需要至少 ${minimum} 条记录`)) return [];
  return value;
}
function unique(values, label) {
  check(values.length === new Set(values).size, `${label} 有重复项`);
}
function https(value, label, allowedHosts) {
  try {
    const url = new URL(value);
    check(url.protocol === 'https:' && !url.username && !url.password && !url.port,
      `${label} 必须是无凭据的 HTTPS URL`);
    if (allowedHosts) check(allowedHosts.includes(url.hostname), `${label} 不是认可的来源域名：${url.hostname}`);
    return url;
  } catch { fail(`${label} 不是有效 URL`); return null; }
}
function file(reference, label, base = root) {
  if (!check(nonempty(reference), `${label} 缺少文件路径`)) return null;
  if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(reference)) { fail(`${label} 必须使用本地文件：${reference}`); return null; }
  let clean;
  try { clean = decodeURIComponent(reference.split(/[?#]/, 1)[0]); }
  catch { fail(`${label} 路径编码无效`); return null; }
  const resolved = path.resolve(clean.startsWith('/') ? root : base, clean.replace(/^\/+/, ''));
  const relative = path.relative(root, resolved);
  if (!check(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    `${label} 路径越出站点目录`)) return null;
  try {
    const stat = fs.statSync(resolved);
    if (!check(stat.isFile() && stat.size > 0, `${label} 文件为空或不是文件：${relative}`)) return null;
    // Windows 对大小写不敏感，但部署目标通常对大小写敏感。
    let current = root;
    for (const part of relative.split(path.sep)) {
      if (!check(fs.readdirSync(current).includes(part), `${label} 路径大小写不符：${relative}`)) return null;
      current = path.join(current, part);
    }
    checkedFiles.add(relative);
    return resolved;
  } catch { fail(`${label} 文件不存在：${relative}`); return null; }
}
function json(filename, label) {
  try { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch (error) { fail(`${label} JSON 无法解析：${error.message}`); return null; }
}
function data(filename, globalName) {
  const resolved = file(filename, globalName);
  if (!resolved) return null;
  const sandbox = { window: {} };
  try { vm.runInNewContext(fs.readFileSync(resolved, 'utf8'), sandbox, { timeout: 1000, filename }); }
  catch (error) { fail(`${filename} 执行失败：${error.message}`); return null; }
  return check(object(sandbox.window[globalName]), `${filename} 未定义 ${globalName}`) ? sandbox.window[globalName] : null;
}

// HTML：所有声明的本地 src/href 都必须存在，锚点与控件引用必须有效。
const index = file('index.html', '首页');
const html = index ? fs.readFileSync(index, 'utf8').replace(/<!--[\s\S]*?-->/g, '') : '';
const tags = [];
for (const match of html.matchAll(/<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)) {
  const attributes = {};
  for (const attr of match[2].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attributes[attr[1].toLowerCase()] = decode(attr[2] ?? attr[3] ?? attr[4] ?? '');
  }
  tags.push({ name: match[1].toLowerCase(), attributes });
}
const ids = tags.flatMap(({ attributes }) => attributes.id !== undefined ? [attributes.id] : []);
unique(ids, 'HTML id');
check(ids.every(nonempty), 'HTML 存在空 id');
const idSet = new Set(ids);
for (const { name, attributes } of tags) {
  for (const key of ['src', 'href']) {
    if (!(key in attributes)) continue;
    const ref = attributes[key];
    const label = `<${name}${attributes.id ? `#${attributes.id}` : ''}> ${key}`;
    if (!check(nonempty(ref), `${label} 为空；动态图片应省略初始 src`)) continue;
    if (/^(?:https?:|mailto:|tel:|data:|blob:)|^\/\//i.test(ref)) continue;
    if (/^[a-z][a-z\d+.-]*:/i.test(ref)) { fail(`${label} 使用不允许的协议`); continue; }
    const hash = ref.indexOf('#');
    const pathname = hash < 0 ? ref : ref.slice(0, hash);
    if (pathname && pathname !== '/' && !pathname.startsWith('?')) file(pathname, label);
    if (hash >= 0 && (!pathname || /^(?:\.\/)?index\.html(?:\?.*)?$/.test(pathname) || pathname === '/')) {
      try {
        const target = decodeURIComponent(ref.slice(hash + 1));
        if (target) check(idSet.has(target), `${label} 锚点不存在：#${target}`);
      } catch { fail(`${label} 锚点编码无效`); }
    }
  }
  for (const key of ['for', 'aria-controls', 'aria-labelledby', 'aria-describedby']) {
    if (attributes[key]) attributes[key].split(/\s+/).forEach((id) => check(idSet.has(id), `<${name}> ${key} 引用不存在：${id}`));
  }
}

const cards = data('assets/data/anon-cards.js', 'ANON_DATA');
if (cards) {
  const items = list(cards.cards, '卡面');
  counts.cards = items.length;
  unique(items.map((card) => card.res), '卡片资源 ID');
  check(cards.cardCount === items.length, 'cardCount 与卡片数量不一致');
  check(cards.character?.id === 37, '卡面角色不是千早爱音（ID 37）');
  const rarity = {};
  for (const card of items) {
    const label = `卡面 ${card.res}`;
    check(nonempty(card.res), `${label} 缺少资源 ID`);
    check(Number.isInteger(card.rarity) && card.rarity >= 1 && card.rarity <= 5, `${label} 稀有度无效`);
    rarity[card.rarity] = (rarity[card.rarity] || 0) + 1;
    check(nonempty(card.nameCn) || nonempty(card.nameJa), `${label} 缺少名称`);
    if (card.date != null) date(card.date, `${label} 发行日期`);
    file(card.standing, `${label} 立绘`);
    if (!check(object(card.variants) && Object.keys(card.variants).length > 0, `${label} 缺少版本`)) continue;
    check(Object.hasOwn(card.variants, card.default), `${label} 默认版本不存在`);
    for (const [key, variant] of Object.entries(card.variants)) {
      counts.variants++;
      file(variant.file, `${label}/${key} 原图`);
      file(variant.thumb, `${label}/${key} 缩略图`);
      if (variant.standing != null) file(variant.standing, `${label}/${key} 立绘`);
      check(Number.isFinite(variant.width) && variant.width > 0 && Number.isFinite(variant.height) && variant.height > 0,
        `${label}/${key} 图片尺寸无效`);
    }
  }
  check(JSON.stringify(Object.entries(rarity).sort()) === JSON.stringify(Object.entries(cards.rarityBreakdown || {}).sort()), '稀有度统计与卡片不一致');
  const cardIds = new Set(items.map((card) => card.res));
  for (const id of list(cards.featured, '精选卡面')) check(cardIds.has(id), `精选卡面不存在：${id}`);
  check(cardIds.has(cards.hero?.res), '首屏卡面不存在');
  file(cards.hero?.file, '首屏卡面');
  file(cards.hero?.standing, '首屏立绘');
}

const live = data('assets/data/anon-live2d.js', 'ANON_LIVE2D');
if (live) {
  const costumes = list(live.costumes, 'Live2D 服装', 3);
  counts.costumes = costumes.length;
  check(live.characterId === 37, 'Live2D 角色不是千早爱音（ID 37）');
  unique(costumes.map((costume) => costume.id), 'Live2D 服装 ID');
  unique(costumes.map((costume) => costume.label), 'Live2D 服装名称');
  check(costumes.some((costume) => costume.id === live.defaultCostume), 'Live2D 默认服装不存在');
  for (const costume of costumes) {
    const label = `Live2D ${costume.id}`;
    check(nonempty(costume.id) && nonempty(costume.label), `${label} 缺少 ID 或名称`);
    const filename = file(costume.modelJson, `${label} model.json`);
    if (!filename) continue;
    const rawModel = json(filename, label);
    if (!rawModel) continue;
    const refs = rawModel.FileReferences;
    const model = refs ? {
      model: refs.Moc, textures: refs.Textures, physics: refs.Physics, pose: refs.Pose,
      motions: Object.fromEntries(Object.entries(refs.Motions || {}).map(([group, entries]) => [group, entries.map((entry) => ({ file: entry.File, sound: entry.Sound }))])),
      expressions: (refs.Expressions || []).map((entry) => ({ name: entry.Name, file: entry.File })),
    } : rawModel;
    const base = path.dirname(filename);
    file(model.model, `${label} 模型`, base);
    for (const texture of list(model.textures, `${label} 纹理`)) file(texture, `${label} 纹理`, base);
    for (const key of ['physics', 'pose']) {
      if (model[key] != null) {
        const dependency = file(model[key], `${label} ${key}`, base);
        if (dependency) json(dependency, `${label} ${key}`);
      }
    }
    const motions = object(model.motions) ? Object.values(model.motions).flat() : [];
    list(motions, `${label} 动作`);
    for (const motion of motions) {
      file(motion.file, `${label} 动作`, base);
      if (motion.sound) file(motion.sound, `${label} 动作声音`, base);
    }
    const minimumExpressions = costume.mode === 'performance' ? 0 : 1;
    const expressions = list(model.expressions, `${label} 表情`, minimumExpressions);
    for (const expression of expressions) {
      const dependency = file(expression.file, `${label} 表情 ${expression.name}`, base);
      if (dependency) json(dependency, `${label} 表情 ${expression.name}`);
    }
    const declaredMotions = list(costume.motions, `${label} 动作目录`);
    const declaredExpressions = list(costume.expressions, `${label} 表情目录`, minimumExpressions);
    const motionFiles = new Set(motions.map((motion) => path.basename(motion.file || '')));
    const expressionNames = new Set(expressions.map((expression) => expression.name));
    check(costume.motionCount === declaredMotions.length, `${label} 动作计数不符`);
    check(costume.expressionCount === declaredExpressions.length, `${label} 表情计数不符`);
    unique(declaredMotions, `${label} 动作目录`);
    unique(declaredExpressions, `${label} 表情目录`);
    for (const name of declaredMotions) check(motionFiles.has(name), `${label} model.json 缺少动作 ${name}`);
    for (const name of declaredExpressions) check(expressionNames.has(name), `${label} model.json 缺少表情 ${name}`);
    const actions = require('../assets/js/live2d-actions.js');
    for (const emotion of Object.keys(actions.defaults)) {
      check(!!actions.resolve(costume, { emotion }), `${label} 缺少有效的 ${emotion} 对话动作映射`);
    }
  }
}

const official = data('assets/data/anon-official.js', 'ANON_OFFICIAL');
if (official) {
  date(official.checkedAt, '官方资料核验日期');
  const hosts = ['bang-dream.com', 'bang-dream.bushimo.jp'];
  https(official.profile?.source, '官方角色来源', hosts);
  https(official.profile?.artistSource, '官方艺术家来源', hosts);
  check(nonempty(official.profile?.summary), '官方角色简介为空');
  for (const detail of list(official.profile?.details, '官方资料字段')) check(nonempty(detail.label) && nonempty(detail.value), '官方资料字段缺少名称或值');
  for (const key of ['image', 'gameImage']) if (official.profile?.[key]) https(official.profile[key], `官方 ${key}`, hosts);
  https(official.storeUrl, '官方商店入口', ['bushiroad-store.com']);
  check(nonempty(official.productNotice), '商品快照缺少说明');
  const products = list(official.products, '商品');
  counts.products = products.length;
  unique(products.map((product) => product.id), '商品 ID');
  for (const product of products) {
    const label = `商品 ${product.id}`;
    for (const key of ['id', 'name', 'originalName', 'category', 'statusLabel']) check(nonempty(product[key]), `${label} 缺少 ${key}`);
    check(Number.isFinite(product.price) && product.price > 0, `${label} 价格无效`);
    check(product.currency === 'JPY' && Number.isInteger(product.price), `${label} 必须使用整数日元价格`);
    check(product.taxIncluded === true, `${label} 应为含税价格`);
    check(['available', 'preorder', 'soldout'].includes(product.status), `${label} 售卖状态无效`);
    date(product.checkedAt, `${label} 核验日期`);
    if (product.releaseDate) date(product.releaseDate, `${label} 发售日期`);
    file(product.image, `${label} 图片`);
    https(product.originalImage, `${label} 图片来源`, ['cdn.shopify.com', 'bushiroad-store.com']);
    const url = https(product.url, `${label} 购买链接`, ['bushiroad-store.com']);
    if (url) check(/^\/products\/[^/]+\/?$/.test(url.pathname), `${label} 链接不是商品详情页`);
  }
}

const wiki = data('assets/data/anon-wiki.js', 'ANON_WIKI');
if (wiki) {
  date(wiki.checkedAt, '百科核验日期');
  check(/^\d+$/.test(wiki.revision), '百科缺少有效修订版本');
  for (const key of ['source', 'revisionUrl', 'historyUrl']) https(wiki[key], `百科 ${key}`, ['zh.moegirl.org.cn']);
  const revision = https(wiki.revisionUrl, '百科固定版本');
  if (revision) check(revision.searchParams.get('oldid') === wiki.revision, '百科固定链接与版本号不一致');
  https(wiki.licenseUrl, '百科许可', ['creativecommons.org']);
  check(nonempty(wiki.summary), '百科简介为空');
  for (const trait of list(wiki.traits, '百科特点')) check(nonempty(trait.title) && nonempty(trait.text), '百科特点缺少标题或正文');
  const honors = list(wiki.honors, '社区荣誉');
  counts.honors = honors.length;
  const year = Number(wiki.checkedAt?.slice(0, 4));
  for (const honor of honors) {
    check(/^\d{4}$/.test(honor.year) && Number(honor.year) >= 2022 && Number(honor.year) <= year, `荣誉年份无效：${honor.year}`);
    check(nonempty(honor.event) && nonempty(honor.result), '荣誉缺少赛事或成绩');
    https(honor.source, `荣誉 ${honor.year} 出处`, ['zh.moegirl.org.cn', 'www.bilibili.com', 'animeawards.moe']);
    check(['主站条目记载', '另经赛事来源核验'].includes(honor.verification), '荣誉缺少明确核验范围');
  }
}

// 拒绝把下载失败时的 HTML 错误页当作图片部署，并解析首页脚本语法。
for (const relative of checkedFiles) {
  const extension = path.extname(relative).toLowerCase();
  const contents = fs.readFileSync(path.join(root, relative));
  const signatures = {
    '.png': () => contents.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    '.jpg': () => contents[0] === 255 && contents[1] === 216 && contents[2] === 255,
    '.jpeg': () => contents[0] === 255 && contents[1] === 216 && contents[2] === 255,
    '.webp': () => contents.toString('ascii', 0, 4) === 'RIFF' && contents.toString('ascii', 8, 12) === 'WEBP',
    '.gif': () => /^GIF8[79]a$/.test(contents.toString('ascii', 0, 6)),
    '.svg': () => /<svg(?:\s|>)/.test(contents.toString('utf8')),
  };
  if (signatures[extension]) check(signatures[extension](), `图片格式与扩展名不符：${relative}`);
  if (extension === '.js') {
    try { new vm.Script(contents.toString('utf8'), { filename: relative }); }
    catch (error) { fail(`脚本语法错误：${relative}：${error.message}`); }
  }
}

if (errors.length) {
  console.error(`站点检查失败：${errors.length} 项问题。`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`站点检查通过：${ids.length} 个唯一 ID，${checkedFiles.size} 个本地文件；${counts.cards} 张卡片 / ${counts.variants} 个版本，${counts.costumes} 套 Live2D，${counts.products} 件商品，${counts.honors} 条社区荣誉。`);
  console.log('此检查为离线文件与数据检查；外链可达性、库存变化、浏览器交互与模型渲染需另行验证。');
}
