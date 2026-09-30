/* =========================================================
   千早愛音 非公式応援サイト — Demo scripts
   卡面数据来源：assets/data/anon-cards.js（由 Bestdori 抓取后生成）
   纯静态、零依赖，留言只存在浏览器本地。
   ========================================================= */

(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (str) =>
    String(str ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const data = window.ANON_DATA || null;
  const allCards = (data && data.cards) || [];
  const starFor = (n) => "★".repeat(Math.max(0, Math.min(5, Number(n) || 0)));

  /* ---------- 1. 顶栏：滚动状态 + 移动端菜单 ---------- */
  const header = $("#siteHeader");
  const nav = $("#nav");
  const navToggle = $("#navToggle");

  const onScroll = () => {
    if (header) header.classList.toggle("is-scrolled", window.scrollY > 8);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const setMenuOpen = (open, restoreFocus = false) => {
    nav?.classList.toggle("is-open", open);
    navToggle?.setAttribute("aria-expanded", String(open));
    navToggle?.setAttribute("aria-label", open ? "收起菜单" : "展开菜单");
    if (restoreFocus) navToggle?.focus();
  };
  navToggle?.addEventListener("click", () => setMenuOpen(!nav?.classList.contains("is-open")));
  nav?.addEventListener("click", (e) => {
    if (e.target.closest("a")) setMenuOpen(false);
  });
  document.addEventListener("pointerdown", (e) => {
    if (nav?.classList.contains("is-open") && !header?.contains(e.target)) setMenuOpen(false);
  });
  document.addEventListener("focusin", (e) => {
    if (nav?.classList.contains("is-open") && !header?.contains(e.target)) setMenuOpen(false);
  });
  window.matchMedia?.("(max-width: 1100px)").addEventListener?.("change", () => setMenuOpen(false));

  /* ---------- 2. 日夜主题（记住选择） ---------- */
  const themeToggle = $("#themeToggle");
  const STORAGE_THEME = "anon-theme";

  const applyTheme = (theme) => {
    document.documentElement.dataset.theme = theme;
    $('meta[name="theme-color"]')?.setAttribute("content", theme === "night" ? "#121020" : "#fff7f9");
    if (themeToggle) {
      themeToggle.setAttribute("aria-pressed", String(theme === "night"));
      themeToggle.setAttribute("aria-label", theme === "night" ? "切换到日间模式" : "切换到夜间模式");
      themeToggle.innerHTML =
        theme === "night"
          ? '<span aria-hidden="true">☀️</span><span class="sr-only">切换主题</span>'
          : '<span aria-hidden="true">🌙</span><span class="sr-only">切换主题</span>';
    }
  };

  let savedTheme = null;
  try { savedTheme = localStorage.getItem(STORAGE_THEME); } catch { /* 隐私模式忽略 */ }
  applyTheme(savedTheme === "night" || savedTheme === "day" ? savedTheme :
    (document.documentElement.dataset.theme === "night" ? "night" : "day"));

  themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "night" ? "day" : "night";
    applyTheme(next);
    try { localStorage.setItem(STORAGE_THEME, next); } catch { /* 忽略 */ }
  });

  /* ---------- 3. 首屏卡面与统计数字 ---------- */
  if (data) {
    const heroImg = $("#heroStanding");
    const heroTag = $("#heroCardTag");
    const heroCard = allCards.find((c) => c.res === (data.hero && data.hero.res));

    const heroStanding = (data.hero && data.hero.standing) || (heroCard && heroCard.standing);
    if (heroImg && heroStanding) {
      heroImg.src = heroStanding;
      heroImg.alt = `${(heroCard && heroCard.nameCn) || "千早爱音"} 官方立绘`;
    }
    if (heroTag && heroCard) {
      heroTag.textContent = `${starFor(heroCard.rarity)} 立绘 · ${heroCard.nameCn || heroCard.nameJa}`;
    }

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value);
    };
    setText("cardTotal", data.cardCount);
    setText("cardCountStat", data.cardCount);
    setText("r5Count", data.rarityBreakdown ? data.rarityBreakdown["5"] : "—");
  }

  /* ---------- 4. 卡面图鉴 ---------- */
  const grid = $("#cardGrid");
  const filterCount = $("#cardFilterCount");
  const rarityChips = $$(".chip[data-rarity]");
  const cardSearch = $("#cardSearch");
  const cardSort = $("#cardSort");
  const cardEmpty = $("#cardEmpty");
  const cardReset = $("#cardReset");
  let selectedRarity = "all";
  let visibleCards = [];
  const normalizeSearch = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase().trim();
  const searchableCards = new Map(allCards.map((card) => [card.res,
    normalizeSearch([card.nameCn, card.nameJa, card.nameEn, card.attributeCn, card.typeCn, card.date].join(" ")),
  ]));
  const cardNodes = new Map();

  const orderedCards = (() => {
    const featured = new Map(((data && data.featured) || []).map((res, i) => [res, i]));
    return allCards
      .map((card, i) => ({ card, i }))
      .sort((a, b) => {
        const fa = featured.has(a.card.res) ? featured.get(a.card.res) : 999;
        const fb = featured.has(b.card.res) ? featured.get(b.card.res) : 999;
        return fa - fb || a.i - b.i;
      })
      .map((x) => x.card);
  })();

  const cardNode = (card) => {
    const keys = Object.keys(card.variants);
    const variantKey = card.variants[card.default] ? card.default : keys[0];
    const variant = card.variants[variantKey];
    const title = card.nameCn || card.nameJa || card.res;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card reveal";
    btn.dataset.res = card.res;
    btn.dataset.rarity = String(card.rarity);
    btn.setAttribute("aria-label", `${title}，${starFor(card.rarity)}，查看大图`);
    btn.innerHTML =
      '<div class="card-media">' +
      `<img src="${esc(variant.thumb)}" alt="${esc(title)} 卡面插画" loading="lazy"` +
      ` width="${variant.width || 1334}" height="${variant.height || 1002}">` +
      `<span class="card-rarity">${starFor(card.rarity)}</span>` +
      `<span class="card-attr" style="background:${esc(card.attributeColor || "#888")}">${esc(card.attributeCn || "")}</span>` +
      (variantKey === "after_training" ? '<span class="card-variant">特训后</span>' : "") +
      "</div>" +
      '<div class="card-body">' +
      `<h3>${esc(title)}</h3>` +
      '<div class="card-sub">' +
      `<span class="card-ja">${esc(card.nameJa || "")}</span>` +
      `<span>${esc(card.date || "—")}</span>` +
      `<span>${esc(card.typeCn || "")}</span>` +
      "</div></div>";
    return btn;
  };

  if (grid) {
    if (orderedCards.length) {
      const frag = document.createDocumentFragment();
      orderedCards.forEach((card) => {
        const node = cardNode(card);
        cardNodes.set(card.res, node);
        frag.appendChild(node);
      });
      grid.appendChild(frag);
    } else {
      grid.innerHTML =
        '<p class="notice">卡面暂时没有加载成功，请刷新页面重试。</p>';
    }
  }

  const updateCards = () => {
    const terms = normalizeSearch(cardSearch?.value).split(/\s+/).filter(Boolean);
    const sort = cardSort?.value || "featured";
    const sorted = orderedCards.slice();
    if (sort === "newest") sorted.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    if (sort === "oldest") sorted.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    if (sort === "rarity") sorted.sort((a, b) => b.rarity - a.rarity);
    visibleCards = sorted.filter((card) => (selectedRarity === "all" || String(card.rarity) === selectedRarity) &&
      terms.every((term) => searchableCards.get(card.res).includes(term)));
    const visibleIds = new Set(visibleCards.map((card) => card.res));
    sorted.forEach((card) => {
      const node = cardNodes.get(card.res);
      if (!node) return;
      node.hidden = !visibleIds.has(card.res);
      node.classList.toggle("is-hidden", node.hidden);
      grid.appendChild(node);
    });
    rarityChips.forEach((chip) => {
      const active = chip.dataset.rarity === selectedRarity;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", String(active));
    });
    if (filterCount) filterCount.textContent = `显示 ${visibleCards.length} / ${allCards.length} 张`;
    if (cardEmpty) cardEmpty.hidden = visibleCards.length > 0 || !allCards.length;
  };

  rarityChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      selectedRarity = chip.dataset.rarity;
      updateCards();
    });
  });
  cardSearch?.addEventListener("input", updateCards);
  cardSort?.addEventListener("change", updateCards);
  cardReset?.addEventListener("click", () => {
    selectedRarity = "all";
    if (cardSearch) cardSearch.value = "";
    if (cardSort) cardSort.value = "featured";
    updateCards();
    cardSearch?.focus();
  });
  updateCards();

  /* ---------- 5. 滚动淡入（卡片渲染完成后执行） ---------- */
  const revealItems = $$(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          window.setTimeout(() => {
            el.classList.remove("is-pending");
            el.classList.add("is-in");
          }, Number(el.dataset.delay || 0));
          io.unobserve(el);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.1 }
    );
    revealItems.forEach((el, i) => {
      el.dataset.delay = String((i % 4) * 70);
      el.classList.add("is-pending");
      io.observe(el);
    });
  } else {
    revealItems.forEach((el) => el.classList.add("is-in"));
  }

  /* ---------- 6. 导航高亮（scroll spy） ---------- */
  const navLinks = $$("#nav a");
  const sections = navLinks
    .map((a) => document.getElementById(a.getAttribute("href").slice(1)))
    .filter(Boolean);

  if (sections.length) {
    let activeSection;
    let spyScheduled = false;
    const updateActiveSection = () => {
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
      const headerBottom = header?.getBoundingClientRect().bottom || 0;
      const readingLine = Math.min(viewportHeight - 1, Math.max(headerBottom + 24, Math.min(viewportHeight * 0.3, 240)));
      const section = sections.find((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.top <= readingLine && bounds.bottom > readingLine;
      });
      const id = section?.id || "";
      if (id === activeSection) return;
      activeSection = id;
      navLinks.forEach((link) => {
        const active = link.getAttribute("href") === `#${id}`;
        link.classList.toggle("is-active", active);
        if (active) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
    };
    const scheduleSpy = () => {
      if (spyScheduled) return;
      spyScheduled = true;
      const nextFrame = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 16));
      nextFrame(() => { spyScheduled = false; updateActiveSection(); });
    };
    // 每批滚动只读一次视口位置。离开导航栏目（如回到首屏）时同步清空旧高亮。
    window.addEventListener("scroll", scheduleSpy, { passive: true });
    window.addEventListener("resize", scheduleSpy);
    window.addEventListener("load", scheduleSpy);
    updateActiveSection();
  }

  /* ---------- 7. 生日倒计时（每年 9 月 8 日） ---------- */
  const countdownEl = $("#birthdayCountdown");
  if (countdownEl) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let target = new Date(now.getFullYear(), 8, 8); // 月份从 0 开始
    if (target < today) target = new Date(now.getFullYear() + 1, 8, 8);
    const days = Math.round((target - today) / 86400000);
    countdownEl.textContent = days === 0 ? "今天就是生日！🎉" : `${days} 天`;
  }

  /* ---------- 8. 作品筛选 ---------- */
  const musicChips = $$(".chip[data-filter]");
  const musicCards = $$("#musicGrid .music-card");
  musicChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const filter = chip.dataset.filter;
      musicChips.forEach((c) => {
        const active = c === chip;
        c.classList.toggle("is-active", active);
        c.setAttribute("aria-pressed", String(active));
      });
      musicCards.forEach((card) => {
        card.classList.toggle("is-hidden", filter !== "all" && card.dataset.kind !== filter);
      });
    });
  });

  /* ---------- 9. 卡面灯箱 ---------- */
  const lightbox = $("#lightbox");
  const lightboxImg = $("#lightboxImg");
  const lightboxTitle = $("#lightboxTitle");
  const lightboxMeta = $("#lightboxMeta");
  const lightboxVariants = $("#lightboxVariants");
  const lightboxClose = $("#lightboxClose");
  const lightboxPrev = $("#lightboxPrev");
  const lightboxNext = $("#lightboxNext");
  const lightboxPosition = $("#lightboxPosition");
  const lightboxImageStatus = $("#lightboxImageStatus");

  let activeCard = null;
  let activeVariant = null;
  let lightboxOpener = null;
  let previousOverflow = "";
  let inertBackground = [];

  const imageStatus = (message, error = false) => {
    if (!lightboxImageStatus) return;
    lightboxImageStatus.textContent = message;
    lightboxImageStatus.hidden = !message;
    lightboxImageStatus.classList.toggle("is-error", error);
  };
  lightboxImg?.addEventListener("load", () => imageStatus(""));
  lightboxImg?.addEventListener("error", () => imageStatus("图片暂时没有加载成功，请试试其他卡面，或稍后重新打开。", true));

  const paintLightbox = () => {
    if (!activeCard || !lightboxImg) return;
    if (!activeCard.variants[activeVariant]) activeVariant = activeCard.default;
    if (!activeCard.variants[activeVariant]) activeVariant = Object.keys(activeCard.variants)[0];
    const variant = activeCard.variants[activeVariant];

    imageStatus("正在加载大图…");
    lightboxImg.src = variant.file;
    lightboxImg.alt = `${activeCard.nameCn || activeCard.nameJa} 卡面大图`;
    lightboxImg.width = variant.width || 1334;
    lightboxImg.height = variant.height || 1002;
    if (lightboxImg.complete && lightboxImg.naturalWidth) imageStatus("");
    const position = visibleCards.findIndex((card) => card.res === activeCard.res);
    if (lightboxPosition) lightboxPosition.textContent = `${position + 1} / ${visibleCards.length}`;
    if (lightboxPrev) lightboxPrev.disabled = visibleCards.length < 2;
    if (lightboxNext) lightboxNext.disabled = visibleCards.length < 2;
    if (lightboxTitle) {
      lightboxTitle.textContent = [...new Set([activeCard.nameCn, activeCard.nameJa].filter(Boolean))].join("｜");
    }
    if (lightboxMeta) {
      lightboxMeta.textContent = [
        starFor(activeCard.rarity),
        activeCard.attributeCn,
        activeCard.typeCn,
        activeCard.date ? `实装 ${activeCard.date}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    if (lightboxVariants) {
      lightboxVariants.innerHTML = "";
      const labels = { normal: "特训前", after_training: "特训后" };
      Object.keys(labels).forEach((key) => {
        if (!activeCard.variants[key]) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chip" + (key === activeVariant ? " is-active" : "");
        btn.dataset.variant = key;
        btn.setAttribute("aria-pressed", String(key === activeVariant));
        btn.textContent = labels[key];
        btn.addEventListener("click", () => {
          activeVariant = key;
          paintLightbox();
          lightboxVariants.querySelector(`[data-variant="${key}"]`)?.focus({ preventScroll: true });
        });
        lightboxVariants.appendChild(btn);
      });
      if (!lightboxVariants.childElementCount) {
        lightboxVariants.innerHTML = '<span class="lightbox-meta">该卡面只有一种版本</span>';
      }
    }
  };

  const openLightbox = (card) => {
    lightboxOpener = document.activeElement;
    activeCard = card;
    activeVariant = card.default;
    paintLightbox();
    if (lightbox) {
      lightbox.hidden = false;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      inertBackground = $$("body > header, body > main, body > footer").map((element) => [element, element.inert]);
      inertBackground.forEach(([element]) => { element.inert = true; });
      lightboxClose?.focus();
    }
  };

  const closeLightbox = () => {
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    document.body.style.overflow = previousOverflow;
    inertBackground.forEach(([element, wasInert]) => { element.inert = wasInert; });
    inertBackground = [];
    if (lightboxOpener?.isConnected && !lightboxOpener.hidden) lightboxOpener.focus({ preventScroll: true });
    else cardSearch?.focus({ preventScroll: true });
  };

  const moveLightbox = (direction) => {
    if (!activeCard || !lightbox || lightbox.hidden || visibleCards.length < 2) return;
    const current = visibleCards.findIndex((card) => card.res === activeCard.res);
    activeCard = visibleCards[(current + direction + visibleCards.length) % visibleCards.length];
    paintLightbox();
  };

  if (grid) {
    grid.addEventListener("click", (e) => {
      const btn = e.target.closest(".card");
      if (!btn) return;
      const card = allCards.find((c) => c.res === btn.dataset.res);
      if (card) openLightbox(card);
    });
  }

  lightboxClose?.addEventListener("click", closeLightbox);
  lightboxPrev?.addEventListener("click", () => moveLightbox(-1));
  lightboxNext?.addEventListener("click", () => moveLightbox(1));
  lightbox?.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (lightbox && !lightbox.hidden) { e.preventDefault(); closeLightbox(); }
      else if (nav?.classList.contains("is-open")) { e.preventDefault(); setMenuOpen(false, true); }
    }
    if (lightbox && !lightbox.hidden && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      moveLightbox(e.key === "ArrowLeft" ? -1 : 1);
    }
    if (e.key === "Tab" && lightbox && !lightbox.hidden) {
      const controls = Array.from(lightbox.querySelectorAll("button:not([disabled]), a[href]"));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (e.shiftKey && (document.activeElement === first || !lightbox.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !lightbox.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
    }
  });

  /* ---------- 10. 留言板（localStorage） ---------- */
  const STORAGE_LETTERS = "anon-letters";
  const form = $("#letterForm");
  const nameInput = $("#letterName");
  const bodyInput = $("#letterBody");
  const countEl = $("#letterCount");
  const listEl = $("#letterList");
  const clearBtn = $("#clearLetters");
  const letterStatus = $("#letterStatus");
  let letterLoadWarning = "";
  let clearedLetters = null;

  const reportLetterStatus = (message, error = false) => {
    if (!letterStatus) return;
    letterStatus.textContent = message;
    letterStatus.classList.toggle("is-error", error);
  };

  const seedLetters = [
    {
      name: "迷子 001 号",
      body: "爱音ちゃん，你已经很努力了，被看见这件事你早就做到了。",
      at: Date.now() - 86400000 * 3,
      example: true,
    },
    {
      name: "吉他部临时部员",
      body: "谢谢你把「想被夸奖」说得那么坦率，我也有点被鼓励到。",
      at: Date.now() - 86400000,
      example: true,
    },
  ];

  const load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_LETTERS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error("无效的留言格式");
        return parsed.filter((item) => item && typeof item.name === "string" && typeof item.body === "string" && Number.isFinite(item.at) && !Number.isNaN(new Date(item.at).getTime()))
          .slice(-200).map((item) => ({ ...item, example: item.example === true ||
            (item.example == null && seedLetters.some((seed) => seed.name === item.name && seed.body === item.body)) }));
      }
    } catch { letterLoadWarning = "未能读取本地留言。下方为示例；请检查浏览器的存储设置。"; }
    return seedLetters;
  };

  let letters = load();

  const persist = (nextLetters) => {
    try {
      localStorage.setItem(STORAGE_LETTERS, JSON.stringify(nextLetters));
      letters = nextLetters;
      return true;
    } catch {
      reportLetterStatus("未能保存：浏览器存储不可用或已满。现有留言和输入内容仍保留，请检查存储设置后重试。", true);
      return false;
    }
  };

  const fmtDate = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
      d.getDate()
    ).padStart(2, "0")}`;
  };

  const renderLetters = () => {
    if (!listEl) return;
    if (clearBtn) {
      clearBtn.textContent = clearedLetters ? "撤销清空" : "清空";
      clearBtn.disabled = !letters.length && !clearedLetters;
    }
    listEl.innerHTML = "";
    if (!letters.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "信箱还是空的，写第一封吧。";
      listEl.appendChild(li);
      return;
    }
    letters
      .slice()
      .sort((a, b) => b.at - a.at)
      .forEach((item) => {
        const li = document.createElement("li");
        const who = document.createElement("div");
        who.className = "who";
        const name = document.createElement("span");
        name.textContent = item.name;
        const time = document.createElement("time");
        time.textContent = fmtDate(item.at);
        time.dateTime = new Date(item.at).toISOString();
        who.append(name, time);
        if (item.example) {
          const badge = document.createElement("span");
          badge.className = "letter-example";
          badge.textContent = "示例留言";
          who.appendChild(badge);
        }
        const p = document.createElement("p");
        p.textContent = item.body;
        li.append(who, p);
        listEl.appendChild(li);
      });
  };

  bodyInput?.addEventListener("input", () => {
    if (countEl) countEl.textContent = String(bodyInput.value.length);
  });

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = (nameInput?.value || "").trim().slice(0, 16);
    const body = (bodyInput?.value || "").trim().slice(0, 120);
    if (!name || !body) return;
    if (!persist([...letters, { name, body, at: Date.now(), example: false }].slice(-200))) return;
    clearedLetters = null;
    renderLetters();
    if (bodyInput) bodyInput.value = "";
    if (countEl) countEl.textContent = "0";
    reportLetterStatus("已投进信箱，保存在当前浏览器。谢谢你的应援！");
    bodyInput?.focus();
  });

  clearBtn?.addEventListener("click", () => {
    if (clearedLetters) {
      if (!persist(clearedLetters)) return;
      clearedLetters = null;
      reportLetterStatus("已恢复清空前的留言。");
    } else {
      if (!letters.length) return;
      const previous = letters.slice();
      if (!persist([])) return;
      clearedLetters = previous;
      reportLetterStatus("留言已清空。可点击「撤销清空」恢复；离开页面或投递新留言后将无法撤销。");
    }
    renderLetters();
  });

  renderLetters();
  if (letterLoadWarning) reportLetterStatus(letterLoadWarning, true);
})();
