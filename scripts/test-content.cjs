"use strict";
// 无依赖离线回归：执行真实 content.js，验证商品渠道链接、萌战海报与精简后的来源说明。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

function createElement(tag = "div", id = "", registry) {
  const element = {
    tagName: tag.toUpperCase(), id, children: [], parentElement: null,
    attributes: {}, dataset: {}, hidden: false, value: "", textContent: "",
    listeners: new Map(),
    style: { values: {}, setProperty(name, value) { this.values[name] = String(value); } },
    classList: {
      classes: new Set(),
      contains(name) { return element.classList.classes.has(name); },
      add(...names) { names.forEach((name) => element.classList.classes.add(name)); },
      remove(...names) { names.forEach((name) => element.classList.classes.delete(name)); },
      toggle(name, force) {
        const next = force === undefined ? !element.classList.classes.has(name) : force;
        if (next) element.classList.classes.add(name); else element.classList.classes.delete(name);
        return next;
      },
    },
    append(...nodes) { nodes.forEach((node) => element.appendChild(node)); },
    appendChild(child) {
      if (child.parentElement) child.parentElement.children = child.parentElement.children.filter((item) => item !== child);
      child.parentElement = element; element.children.push(child); return child;
    },
    setAttribute(name, value) { element.attributes[name] = String(value); },
    getAttribute(name) { return element.attributes[name] ?? null; },
    addEventListener(type, callback) {
      if (!element.listeners.has(type)) element.listeners.set(type, []);
      element.listeners.get(type).push(callback);
    },
    matches(selector) {
      const id = selector.match(/#([\w-]+)/)?.[1];
      if (id && id !== element.id) return false;
      const tag = selector.match(/^[a-z]+/i)?.[0];
      if (tag && tag.toUpperCase() !== element.tagName) return false;
      return ![...selector.matchAll(/\.([\w-]+)/g)].some((match) => !element.classList.contains(match[1]));
    },
    querySelectorAll(selector) {
      return element.children.flatMap((child) => [child, ...child.querySelectorAll("*")])
        .filter((child) => selector.split(",").some((part) => child.matches(part.trim())));
    },
    querySelector(selector) { return element.querySelectorAll(selector)[0] || null; },
  };
  Object.defineProperty(element, "className", {
    get: () => [...element.classList.classes].join(" "),
    set: (value) => { element.classList.classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach((name) => element.classList.classes.add(name)); },
  });
  Object.defineProperty(element, "innerText", { get: () => element.textContent });
  if (id) registry.set(id, element);
  return element;
}

function createSite() {
  const registry = new Map();
  const document = createElement("document", "", registry);
  const add = (tag, id, parent = document.body) => parent.appendChild(createElement(tag, id, registry));
  document.body = add("body", "", document);
  document.createElement = (tag) => createElement(tag, "", registry);
  document.getElementById = (id) => registry.get(id) || null;
  // 按首页真实存在的 id 建 DOM：content.js 一旦写入已删除的元素就会抛错。
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  ids.forEach((id) => add("div", id));
  ["all", "available", "preorder"].forEach((status) => {
    const chip = add("button", "", document.body);
    chip.className = "chip"; chip.dataset.goodsFilter = status; chip.setAttribute("aria-pressed", "false");
  });
  const window = {};
  const context = { document, window, console, Intl, encodeURIComponent };
  for (const file of ["assets/data/anon-official.js", "assets/data/anon-wiki.js", "assets/js/content.js"]) {
    vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), context);
  }
  return { document, window, $: (id) => registry.get(id) };
}

const site = createSite();
const { document, window: siteWindow, $ } = site;
const official = siteWindow.ANON_OFFICIAL;
const wiki = siteWindow.ANON_WIKI;

/* ---------- 商品：官方商店之外再加淘宝与会员购检索入口 ---------- */
const goodsCards = $("goodsGrid").children;
assert.equal(goodsCards.length, official.products.length, "商品卡片数量与数据一致");
goodsCards.forEach((card, index) => {
  const product = official.products[index];
  const keyword = product.marketKeyword || product.name;
  const market = card.querySelectorAll(".goods-market")[0];
  assert.ok(market, `商品 ${product.id} 缺少购买渠道容器`);
  const [taobao, mall] = market.children;
  assert.equal(taobao.href, `https://s.taobao.com/search?q=${encodeURIComponent(keyword)}`, `商品 ${product.id} 淘宝链接不正确`);
  assert.equal(mall.href, `https://mall.bilibili.com/neul-next/index.html?page=flow_searchResult&keyword=${encodeURIComponent(keyword)}`, `商品 ${product.id} 会员购链接不正确`);
  assert.equal(taobao.target, "_blank", `商品 ${product.id} 渠道链接应在新标签打开`);
  assert.equal(taobao.rel, "noopener noreferrer", `商品 ${product.id} 渠道链接缺少 rel`);
});

/* ---------- 萌战海报：与荣誉条目一一对应，且立绘文件存在 ---------- */
const posters = $("moePosters").children;
assert.equal(posters.length, wiki.posters.length, "海报数量与数据一致");
assert.ok(posters.length >= 5, "萌战海报至少覆盖主要赛事");
wiki.posters.forEach((poster, index) => {
  // 海报奖杯文字比荣誉表更短，只要求赛事、年份一致且成绩关键词吻合。
  const matched = wiki.honors.find((honor) => honor.event === poster.event && honor.year === poster.year);
  assert.ok(matched, `海报《${poster.event}》没有对应的荣誉记录`);
  assert.ok(matched.result.includes(poster.result.slice(0, 2)), `海报《${poster.event}》的成绩与荣誉记录不一致`);
  assert.ok(fs.existsSync(path.join(root, poster.art)), `海报《${poster.event}》的立绘不存在`);
  const figure = posters[index];
  assert.equal(figure.style.values["--poster-art"], `url("${poster.art}")`, `海报《${poster.event}》缺少立绘背景`);
  const frame = figure.querySelectorAll(".moe-poster-frame")[0];
  assert.ok(frame, `海报《${poster.event}》缺少版式容器`);
  assert.equal(frame.querySelectorAll(".moe-poster-year")[0].textContent, poster.year);
  assert.ok(frame.querySelectorAll(".moe-poster-badge")[0].textContent.includes(poster.result), `海报《${poster.event}》成绩文字不一致`);
  const caption = figure.querySelectorAll("figcaption")[0];
  assert.ok(caption.querySelectorAll("a")[0].href === poster.source, `海报《${poster.event}》缺少出处链接`);
});
assert.equal($("honorsList").children.length, wiki.honors.length, "荣誉列表条数不变");

/* ---------- 精简来源说明：页面只保留最后一处 ---------- */
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
for (const id of ["goodsNotice", "goodsSnapshot", "wikiAttribution"]) {
  assert.ok(!html.includes(`id="${id}"`), `index.html 不应再保留前置来源说明 #${id}`);
  assert.ok(!fs.readFileSync(path.join(root, "assets/js/content.js"), "utf8").includes(`'${id}'`), `content.js 不应再写入 #${id}`);
}
assert.equal(html.match(/class="source-note"/g), null, "正文内不应再出现前置来源说明");
assert.ok(html.includes('class="source-grid"'), "页面仍保留最后的素材来源区");

console.log(`内容渲染检查通过：${goodsCards.length} 件商品带渠道链接，${posters.length} 张萌战海报，前置来源说明已省略。`);
