"use strict";
// 无依赖离线回归：执行真实 main.js，DOM 替身只提供浏览器基础接口。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

function createSite({ saved = {}, theme = "day", storageFails = false } = {}) {
  let document;
  const registry = new Map();
  class Element {
    constructor(tag = "div", id = "") {
      this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.parentElement = null;
      this.attributes = {}; this.dataset = {}; this.style = {}; this.listeners = new Map();
      this.hidden = false; this.disabled = false; this.inert = false; this.value = ""; this.textContent = "";
      const classes = new Set();
      this.classList = { contains: (name) => classes.has(name),
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        toggle: (name, force) => {
          const next = force === undefined ? !classes.has(name) : force;
          if (next) classes.add(name); else classes.delete(name);
          return next;
        } };
      Object.defineProperty(this, "className", { get: () => [...classes].join(" "), set: (value) => {
        classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
      } });
      if (id) registry.set(id, this);
    }
    set innerHTML(value) { this.children.forEach((child) => { child.parentElement = null; }); this.children = []; this._html = value; }
    get innerHTML() { return this._html || ""; }
    get childElementCount() { return this.children.length; }
    get isConnected() { return this === document || !!this.parentElement?.isConnected; }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    appendChild(child) {
      if (child.tagName === "FRAGMENT") { [...child.children].forEach((item) => this.appendChild(item)); return child; }
      if (child.parentElement) child.parentElement.children = child.parentElement.children.filter((item) => item !== child);
      child.parentElement = this; this.children.push(child); return child;
    }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    emit(type, additions = {}) {
      const event = { type, target: this, preventDefault() { this.defaultPrevented = true; }, ...additions };
      this.listeners.get(type)?.forEach((fn) => fn(event)); return event;
    }
    matches(selector) {
      if (selector.includes(":not([disabled])")) {
        if (this.disabled) return false;
        selector = selector.replace(":not([disabled])", "");
      }
      const id = selector.match(/#([\w-]+)/)?.[1];
      if (id && id !== this.id) return false;
      const tag = selector.match(/^[a-z]+/i)?.[0];
      if (tag && tag.toUpperCase() !== this.tagName) return false;
      if ([...selector.matchAll(/\.([\w-]+)/g)].some((match) => !this.classList.contains(match[1]))) return false;
      for (const [, name, value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        const actual = name.startsWith("data-") ? this.dataset[name.slice(5)] : this.getAttribute(name);
        if (actual == null || (value !== undefined && actual !== value)) return false;
      }
      return true;
    }
    querySelectorAll(selector) {
      const all = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
      return all.filter((element) => selector.split(",").some((part) => {
        const direct = part.includes(">");
        const tokens = part.trim().split(/\s*>\s*|\s+/);
        if (!element.matches(tokens.pop())) return false;
        let ancestor = element.parentElement;
        while (tokens.length) {
          const token = tokens.pop();
          while (ancestor && !ancestor.matches(token) && !direct) ancestor = ancestor.parentElement;
          if (!ancestor?.matches(token)) return false;
          ancestor = ancestor.parentElement;
        }
        return true;
      }));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
    contains(element) { return element === this || this.children.some((child) => child.contains(element)); }
    getBoundingClientRect() { return this.rect || { top: 10000, bottom: 10000 }; }
    focus() { document.activeElement = this; document.emit("focusin", { target: this }); }
  }
  document = new Element("document");
  const add = (tag, id, parent = document) => parent.appendChild(new Element(tag, id));
  document.documentElement = add("html", ""); document.documentElement.dataset.theme = theme;
  const meta = add("meta", "", document.documentElement); meta.setAttribute("name", "theme-color");
  document.body = add("body", "", document.documentElement); document.activeElement = document.body;
  document.createElement = (tag) => new Element(tag);
  document.createDocumentFragment = () => new Element("fragment");
  document.getElementById = (id) => registry.get(id) || null;
  const header = add("header", "siteHeader", document.body);
  header.rect = { top: 0, bottom: 70 };
  const nav = add("nav", "nav", header); const navLink = add("a", "", nav); navLink.setAttribute("href", "#cards");
  add("button", "navToggle", header); add("button", "themeToggle", header);
  const main = add("main", "main", document.body); add("footer", "", document.body);
  add("section", "cards", main);
  ["cardGrid", "cardFilterCount", "cardEmpty", "letterList", "letterCount", "letterStatus"].forEach((id) => add("div", id, main));
  ["cardSearch", "letterName", "letterBody"].forEach((id) => add("input", id, main));
  add("select", "cardSort", main).value = "featured";
  ["cardReset", "clearLetters"].forEach((id) => add("button", id, main));
  add("form", "letterForm", main);
  ["all", "5", "4", "3", "2", "1"].forEach((rarity) => {
    const chip = add("button", "", main); chip.className = "chip"; chip.dataset.rarity = rarity;
  });
  const lightbox = add("div", "lightbox", document.body); lightbox.hidden = true;
  ["lightboxClose", "lightboxPrev", "lightboxNext"].forEach((id) => add("button", id, lightbox));
  ["lightboxTitle", "lightboxMeta", "lightboxVariants", "lightboxPosition", "lightboxImageStatus"].forEach((id) => add("div", id, lightbox));
  add("img", "lightboxImg", lightbox);
  const store = new Map(Object.entries(saved)); let failWrites = storageFails;
  const localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => {
    if (failWrites) throw new Error("QuotaExceededError"); store.set(key, value);
  } };
  const windowListeners = new Map();
  const frames = [];
  const window = { scrollY: 0, innerHeight: 800,
    addEventListener(type, callback) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(callback);
    },
    requestAnimationFrame: (callback) => frames.push(callback),
    setTimeout: (fn) => fn(), matchMedia: () => ({ addEventListener() {} }) };
  const context = { document, window, localStorage, console, HTMLAnchorElement: Element };
  vm.runInNewContext(fs.readFileSync(path.join(root, "assets/data/anon-cards.js"), "utf8"), context);
  vm.runInNewContext(fs.readFileSync(path.join(root, "assets/js/main.js"), "utf8"), context);
  return { $, cards: window.ANON_DATA.cards, document, store, meta, navLink, failWrites: (value) => { failWrites = value; },
    emitWindow: (type) => windowListeners.get(type)?.forEach((callback) => callback()),
    frameCount: () => frames.length, flushFrames: () => frames.splice(0).forEach((callback) => callback()),
    visible: () => $("cardGrid").children.filter((card) => !card.hidden),
    clickCard: (card) => { card.focus(); $("cardGrid").emit("click", { target: card }); } };
  function $(id) { return registry.get(id); }
}

const site = createSite({ theme: "night" });
const { $, document, cards } = site;
assert.equal(document.documentElement.dataset.theme, "night", "main.js 保留 head 已应用的系统夜间主题");
assert.equal(site.meta.getAttribute("content"), "#121020");
$("themeToggle").emit("click");
assert.equal(site.store.get("anon-theme"), "day");
assert.equal(site.meta.getAttribute("content"), "#fff7f9");
assert.equal(site.navLink.getAttribute("aria-current"), null, "首屏不误高亮导航栏目");
$("cards").rect = { top: 100, bottom: 900 };
site.emitWindow("scroll"); site.emitWindow("scroll"); site.emitWindow("scroll");
assert.equal(site.frameCount(), 1, "连续滚动事件合并为一次视口检查");
site.flushFrames();
assert.equal(site.navLink.getAttribute("aria-current"), "location");
assert.equal(site.navLink.classList.contains("is-active"), true);
assert.equal(site.frameCount(), 0, "不会递归安排热循环");
$("cards").rect = { top: 10000, bottom: 11000 }; site.emitWindow("scroll"); site.flushFrames();
assert.equal(site.navLink.getAttribute("aria-current"), null, "返回顶部须清空旧栏目的语义高亮");
assert.equal(site.navLink.classList.contains("is-active"), false);
$("cards").rect = { top: -600, bottom: 190 }; site.emitWindow("resize"); site.flushFrames();
assert.equal(site.navLink.getAttribute("aria-current"), null, "位于无导航项栏目时保持无高亮");
assert.equal(site.visible().length, 16);
const setSearch = (text) => { $("cardSearch").value = text; $("cardSearch").emit("input"); };
for (const key of ["nameCn", "nameJa", "nameEn"]) {
  setSearch(cards[0][key]);
  assert.ok(site.visible().some((node) => node.dataset.res === cards[0].res), `${key} 可检索`);
}
setSearch(cards[0].nameEn.toUpperCase()); assert.equal(site.visible()[0].dataset.res, cards[0].res);
setSearch("不存在的卡面ZZZZ"); assert.equal(site.visible().length, 0); assert.equal($("cardEmpty").hidden, false);
$("cardReset").emit("click"); assert.equal(site.visible().length, 16); assert.equal(document.activeElement, $("cardSearch"));
const rarity5 = document.querySelector('.chip[data-rarity="5"]'); rarity5.emit("click");
assert.equal(site.visible().length, 6); assert.equal(rarity5.getAttribute("aria-pressed"), "true");
$("cardSort").value = "newest"; $("cardSort").emit("change");
const dates = site.visible().map((node) => cards.find((card) => card.res === node.dataset.res).date);
assert.deepEqual(dates, dates.slice().sort().reverse());
const opened = site.visible()[0]; site.clickCard(opened);
assert.equal($("main").inert, true); assert.equal(document.activeElement, $("lightboxClose"));
assert.equal($("lightboxPosition").textContent, "1 / 6");
document.emit("keydown", { key: "ArrowLeft" }); assert.equal($("lightboxPosition").textContent, "6 / 6");
document.emit("keydown", { key: "ArrowRight" }); assert.equal($("lightboxPosition").textContent, "1 / 6");
$("lightboxNext").emit("click"); assert.equal($("lightboxPosition").textContent, "2 / 6");
$("lightboxVariants").children[0].emit("click");
assert.equal(document.activeElement.getAttribute("aria-pressed"), "true", "切换特训版本后焦点仍在新建的对应按钮");
$("lightboxImg").emit("error"); assert.equal($("lightboxImageStatus").hidden, false);
$("lightboxImg").emit("load"); assert.equal($("lightboxImageStatus").hidden, true);
$("lightboxClose").focus(); document.emit("keydown", { key: "Tab", shiftKey: true });
assert.equal(document.activeElement, $("lightboxVariants").children.at(-1), "Shift+Tab 留在灯箱内");
document.emit("keydown", { key: "Escape" });
assert.equal($("lightbox").hidden, true); assert.equal($("main").inert, false); assert.equal(document.activeElement, opened);
$("cardReset").emit("click"); document.querySelector('.chip[data-rarity="1"]').emit("click");
site.clickCard(site.visible()[0]); assert.equal($("lightboxNext").disabled, true); assert.equal($("lightboxPrev").disabled, true);
document.emit("keydown", { key: "ArrowRight" }); assert.equal($("lightboxPosition").textContent, "1 / 1");
document.emit("keydown", { key: "Escape" });
$("navToggle").emit("click"); assert.equal($("navToggle").getAttribute("aria-expanded"), "true");
document.emit("keydown", { key: "Escape" }); assert.equal(document.activeElement, $("navToggle"));
$("navToggle").emit("click"); document.emit("pointerdown", { target: $("main") }); assert.equal($("nav").classList.contains("is-open"), false);
$("navToggle").emit("click"); $("cardSearch").focus(); assert.equal($("nav").classList.contains("is-open"), false);

assert.equal($("letterList").querySelectorAll(".letter-example").length, 2, "初始留言须明确标记示例");
const enterLetter = () => { $("letterName").value = "迷子"; $("letterBody").value = "一起加油！"; $("letterForm").emit("submit"); };
enterLetter(); assert.equal(JSON.parse(site.store.get("anon-letters")).length, 3);
assert.equal($("letterBody").value, ""); assert.equal($("letterName").value, "迷子");
$("clearLetters").emit("click"); assert.equal(site.store.get("anon-letters"), "[]"); assert.equal($("clearLetters").textContent, "撤销清空");
site.failWrites(true); $("clearLetters").emit("click");
assert.equal(site.store.get("anon-letters"), "[]"); assert.equal($("clearLetters").textContent, "撤销清空", "撤销失败保留恢复机会");
site.failWrites(false); $("clearLetters").emit("click"); assert.equal(JSON.parse(site.store.get("anon-letters")).length, 3);
site.failWrites(true); enterLetter(); assert.equal($("letterBody").value, "一起加油！");
assert.equal($("letterStatus").classList.contains("is-error"), true);
$("clearLetters").emit("click"); assert.equal(JSON.parse(site.store.get("anon-letters")).length, 3, "清空失败不删除现有留言");
const malformed = createSite({ saved: { "anon-letters": '[{"name":"异常","body":"数据","at":1e100}]' } });
assert.equal(malformed.$("letterList").children[0].className, "empty", "无效日期不能使页面脚本崩溃");
const corrupt = createSite({ saved: { "anon-letters": "not json" } });
assert.equal(corrupt.$("letterStatus").classList.contains("is-error"), true);
console.log("PASS 卡面搜索/组合筛选/排序/灯箱键盘与焦点、移动菜单、主题、留言撤销及存储失败回归。");
