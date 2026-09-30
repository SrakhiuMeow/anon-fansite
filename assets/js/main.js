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

  navToggle?.addEventListener("click", () => {
    const open = nav ? nav.classList.toggle("is-open") : false;
    navToggle.setAttribute("aria-expanded", String(open));
  });
  nav?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLAnchorElement) {
      nav.classList.remove("is-open");
      navToggle?.setAttribute("aria-expanded", "false");
    }
  });

  /* ---------- 2. 日夜主题（记住选择） ---------- */
  const themeToggle = $("#themeToggle");
  const STORAGE_THEME = "anon-theme";

  const applyTheme = (theme) => {
    document.documentElement.dataset.theme = theme;
    if (themeToggle) {
      themeToggle.setAttribute("aria-pressed", String(theme === "night"));
      themeToggle.innerHTML =
        theme === "night"
          ? '<span aria-hidden="true">☀️</span><span class="sr-only">切换主题</span>'
          : '<span aria-hidden="true">🌙</span><span class="sr-only">切换主题</span>';
    }
  };

  let savedTheme = null;
  try { savedTheme = localStorage.getItem(STORAGE_THEME); } catch { /* 隐私模式忽略 */ }
  applyTheme(savedTheme === "night" ? "night" : "day");

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
      orderedCards.forEach((card) => frag.appendChild(cardNode(card)));
      grid.appendChild(frag);
    } else {
      grid.innerHTML =
        '<p class="notice">没有读到卡面数据。请先运行 scripts/fetch_bestdori.py 与 scripts/build_site_data.py。</p>';
    }
  }

  const updateFilterCount = () => {
    if (!filterCount || !grid) return;
    const shown = $$(".card", grid).filter((c) => !c.classList.contains("is-hidden")).length;
    filterCount.textContent = `显示 ${shown} / ${allCards.length} 张`;
  };

  rarityChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const want = chip.dataset.rarity;
      rarityChips.forEach((c) => {
        const active = c === chip;
        c.classList.toggle("is-active", active);
        c.setAttribute("aria-selected", String(active));
      });
      $$(".card", grid || document).forEach((card) => {
        card.classList.toggle("is-hidden", want !== "all" && card.dataset.rarity !== want);
      });
      updateFilterCount();
    });
  });
  updateFilterCount();

  /* ---------- 5. 滚动淡入（卡片渲染完成后执行） ---------- */
  const revealItems = $$(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          window.setTimeout(() => el.classList.add("is-in"), Number(el.dataset.delay || 0));
          io.unobserve(el);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.1 }
    );
    revealItems.forEach((el, i) => {
      el.dataset.delay = String((i % 4) * 70);
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

  if (sections.length && "IntersectionObserver" in window) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const id = entry.target.id;
          navLinks.forEach((a) =>
            a.classList.toggle("is-active", a.getAttribute("href") === `#${id}`)
          );
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    sections.forEach((s) => spy.observe(s));
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
        c.setAttribute("aria-selected", String(active));
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

  let activeCard = null;
  let activeVariant = null;
  let lightboxOpener = null;

  const paintLightbox = () => {
    if (!activeCard || !lightboxImg) return;
    const variant = activeCard.variants[activeVariant] || activeCard.variants[activeCard.default];

    lightboxImg.src = variant.file;
    lightboxImg.alt = `${activeCard.nameCn || activeCard.nameJa} 卡面大图`;
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
        btn.textContent = labels[key];
        btn.addEventListener("click", () => {
          activeVariant = key;
          paintLightbox();
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
      document.body.style.overflow = "hidden";
      lightboxClose?.focus();
    }
  };

  const closeLightbox = () => {
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    document.body.style.overflow = "";
    lightboxOpener?.focus();
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
  lightbox?.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
    if (e.key === "Tab" && lightbox && !lightbox.hidden) {
      const controls = Array.from(lightbox.querySelectorAll("button:not([disabled]), a[href]"));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
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

  const seedLetters = [
    {
      name: "迷子 001 号",
      body: "爱音ちゃん，你已经很努力了，被看见这件事你早就做到了。",
      at: Date.now() - 86400000 * 3,
    },
    {
      name: "吉他部临时部员",
      body: "谢谢你把「想被夸奖」说得那么坦率，我也有点被鼓励到。",
      at: Date.now() - 86400000,
    },
  ];

  const load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_LETTERS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter((item) => item && typeof item.name === "string" && typeof item.body === "string" && Number.isFinite(item.at)).slice(-200);
      }
    } catch { /* 忽略 */ }
    return seedLetters;
  };

  let letters = load();

  const persist = () => {
    try { localStorage.setItem(STORAGE_LETTERS, JSON.stringify(letters)); } catch { /* 忽略 */ }
  };

  const fmtDate = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
      d.getDate()
    ).padStart(2, "0")}`;
  };

  const renderLetters = () => {
    if (!listEl) return;
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
        who.append(name, time);
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
    const name = (nameInput?.value || "").trim();
    const body = (bodyInput?.value || "").trim();
    if (!name || !body) return;
    letters.push({ name, body, at: Date.now() });
    letters = letters.slice(-200);
    persist();
    renderLetters();
    form.reset();
    if (countEl) countEl.textContent = "0";
  });

  clearBtn?.addEventListener("click", () => {
    letters = [];
    persist();
    renderLetters();
  });

  renderLetters();
})();
