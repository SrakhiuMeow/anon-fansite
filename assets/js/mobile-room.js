/* 手机沉浸房间：复用原有播放器与聊天控件，桌面恢复原始结构及状态。 */
(() => {
  "use strict";
  const byId = (id) => document.getElementById(id);
  const room = byId("anonRoom");
  const controls = byId("mobileRoomControls");
  if (!room || !controls || !window.matchMedia) return;
  // 竖屏手机布局以宽度识别，避免部分键盘缩小页面高度后误切换界面。
  const media = window.matchMedia("(max-width: 700px)");
  const chat = byId("roomChatPanel");
  const tools = byId("roomToolsPanel");
  const dock = byId("mobileRoomDock");
  const prompt = byId("mobileRoomPrompt");
  const input = byId("anonChatInput");
  const chatButton = byId("mobileRoomChat");
  const toolsButton = byId("mobileRoomTools");
  const expressionsButton = byId("mobileRoomExpressions");
  const motionsButton = byId("mobileRoomMotions");
  const chatTab = byId("mobileRoomChatTab");
  const toolsTab = byId("mobileRoomToolsTab");
  const expressionsTab = byId("mobileRoomExpressionsTab");
  const motionsTab = byId("mobileRoomMotionsTab");
  const panelButtons = { chat: chatButton, tools: toolsButton, expressions: expressionsButton, motions: motionsButton };
  const panelTabs = { chat: chatTab, tools: toolsTab, expressions: expressionsTab, motions: motionsTab };
  const panelLabels = { chat: "与爱音聊天", tools: "模型换装与操作", expressions: "模型表情", motions: "模型动作" };
  const fullscreen = byId("mobileRoomFullscreen");
  const costumeHost = byId("l2dCostumes");
  const modelSettings = room.querySelector(".model-settings");
  const preferences = byId("chatPreferences");
  const preferencesButton = byId("mobileRoomChatSettings");
  const zoom = room.querySelector(".l2d-zoom");
  const zoomHost = byId("mobileRoomZoomHost");
  const playback = byId("mobileRoomPlayback");
  const costumeGroup = byId("l2dCostumeGroup");
  const motionGroup = byId("l2dMotionGroup");
  const expressionGroup = byId("l2dExpressionGroup");
  const modelHint = byId("l2dHint");
  const zoomMarker = document.createComment("桌面模型缩放控件位置");
  if (zoom) zoom.before(zoomMarker);
  const savedAccess = new Map();
  const savedBackground = new Map();
  let mobile = false;
  let immersive = false;
  let panel = "closed";
  let previousPanel = "chat";
  let detailsState = null;
  let scrollState = null;
  let returnFocus = null;
  let automaticEntry = false;
  let bodyStyles = null;
  let viewportFrame = 0;
  let unobscuredHeight = 0;
  const viewportProperties = ["--room-viewport-height", "--room-viewport-top", "--room-keyboard-inset"];
  const bodyProperties = ["position", "top", "left", "right", "width", "overflow"];
  const dialogOpen = () => !!room.querySelector("dialog[open]");
  const focus = (element) => element?.focus({ preventScroll: true });
  const saveAttributes = (element) => ({ inert: element.getAttribute("inert"), ariaHidden: element.getAttribute("aria-hidden") });
  const restoreAttributes = (element, state) => {
    for (const [name, value] of [["inert", state.inert], ["aria-hidden", state.ariaHidden]]) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
  };
  const expose = (element, visible) => {
    if (!element) return;
    if (!savedAccess.has(element)) savedAccess.set(element, saveAttributes(element));
    element.toggleAttribute("inert", !visible);
    if (visible) element.removeAttribute("aria-hidden");
    else element.setAttribute("aria-hidden", "true");
  };
  const syncPanel = () => {
    if (!mobile) return;
    room.dataset.panel = panel;
    const chatting = panel === "chat";
    const choosing = panel === "tools";
    expose(controls, panel !== "closed");
    expose(chat, chatting);
    expose(preferencesButton, chatting);
    expose(tools, ["tools", "expressions", "motions"].includes(panel));
    // 缩放是舞台上的常驻操作，不随聊天或换装浮层一起收起。
    expose(zoomHost, true);
    expose(playback, choosing);
    expose(costumeGroup, choosing);
    expose(motionGroup, panel === "motions");
    expose(expressionGroup, panel === "expressions");
    expose(modelHint, ["tools", "expressions", "motions"].includes(panel));
    expose(dock, panel === "closed");
    expose(prompt, panel === "closed");
    for (const [name, button] of Object.entries(panelButtons)) button?.setAttribute("aria-expanded", String(panel === name));
    prompt?.setAttribute("aria-expanded", String(chatting));
    for (const [name, tab] of Object.entries(panelTabs)) tab?.setAttribute("aria-pressed", String(panel === name));
    controls.setAttribute("aria-label", panelLabels[panel] || "爱音互动面板");
    scheduleViewport();
  };
  const setPanel = (next, moveFocus = false) => {
    if (!mobile || !["closed", ...Object.keys(panelButtons)].includes(next)) return false;
    // 密码框处于浏览器顶层时，不隐藏其祖先，也不抢走弹窗焦点。
    if (dialogOpen() && next !== "chat") return false;
    if (next === "closed") {
      if (panel !== "closed") previousPanel = panel;
      if (controls.contains(document.activeElement)) document.activeElement.blur();
    } else previousPanel = next;
    const changed = panel !== next;
    panel = next;
    syncPanel();
    if (changed && tools && ["tools", "expressions", "motions"].includes(next)) tools.scrollTop = 0;
    if (moveFocus) focus(next === "closed" ? panelButtons[previousPanel] : panelTabs[next]);
    return true;
  };
  const syncFullscreen = () => {
    room.classList.toggle("is-immersive", immersive);
    document.body.classList.toggle("room-immersive", immersive);
    fullscreen?.setAttribute("aria-pressed", String(immersive));
    const label = immersive ? "退出全屏互动" : "进入全屏互动";
    fullscreen?.setAttribute("aria-label", label);
    if (fullscreen) fullscreen.title = label;
  };
  const isolateBackground = () => {
    // 逐层只处理兄弟节点，绝不把包含模型或对话框的祖先设为 inert。
    for (let branch = room; branch?.parentElement; branch = branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling === branch || /^(SCRIPT|STYLE|LINK)$/.test(sibling.tagName)) continue;
        if (!savedBackground.has(sibling)) savedBackground.set(sibling, saveAttributes(sibling));
        sibling.setAttribute("inert", "");
      }
      if (branch.parentElement === document.body) break;
    }
  };
  const enter = (automatic = false) => {
    if (!mobile) return false;
    if (immersive) return true;
    const outsideDialog = Array.from(document.querySelectorAll("dialog[open]")).some((dialog) => !room.contains(dialog));
    if (outsideDialog || document.querySelector(".lightbox:not([hidden])")) return false;
    automaticEntry = automatic;
    returnFocus = automatic ? null : document.activeElement;
    scrollState = { x: window.scrollX, y: window.scrollY };
    bodyStyles = bodyProperties.map((name) => [name, document.body.style.getPropertyValue(name), document.body.style.getPropertyPriority(name)]);
    document.body.style.position = "fixed";
    document.body.style.top = `${-scrollState.y}px`;
    document.body.style.left = `${-scrollState.x}px`;
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    immersive = true;
    syncFullscreen();
    isolateBackground();
    scheduleViewport();
    return true;
  };
  const browseProfile = () => {
    const section = byId("profile");
    const heading = section?.querySelector("h2") || section;
    if (heading && !heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    section?.scrollIntoView({ block: "start", behavior: "instant" });
    focus(heading);
  };
  const exit = (restoreFocus = true) => {
    if (!immersive) return;
    immersive = false;
    syncFullscreen();
    for (const [element, state] of savedBackground) restoreAttributes(element, state);
    savedBackground.clear();
    for (const [name, value, priority] of bodyStyles || []) {
      if (value) document.body.style.setProperty(name, value, priority);
      else document.body.style.removeProperty(name);
    }
    bodyStyles = null;
    if (scrollState) window.scrollTo({ left: scrollState.x, top: scrollState.y, behavior: "instant" });
    scrollState = null;
    if (restoreFocus && !dialogOpen() && automaticEntry && mobile) browseProfile();
    else if (restoreFocus && !dialogOpen()) {
      const target = [returnFocus, byId("navToggle"), byId("siteHeader")?.querySelector("a[href]")]
        .find((element) => element?.isConnected && element.getClientRects().length && !element.closest("[inert]"));
      focus(target);
    }
    returnFocus = null;
    automaticEntry = false;
    scheduleViewport();
  };
  const openPanel = (next, moveFocus = true) => {
    if (!mobile || !enter()) return;
    setPanel(next, moveFocus);
  };
  const syncCostume = (state = window.AnonLive2D?.getState?.() || {}) => {
    const buttons = Array.from(costumeHost?.querySelectorAll("button[data-value]") || []);
    const active = buttons.find((button) => button.classList.contains("is-active") || button.getAttribute("aria-pressed") === "true");
    const costumes = window.ANON_LIVE2D?.costumes || [];
    const id = state.costume || active?.dataset.value || window.ANON_LIVE2D?.defaultCostume;
    const costume = costumes.find((item) => item.id === id);
    const name = costume?.label || active?.textContent || "ANON'S ROOM";
    const label = byId("mobileRoomCostume");
    if (label) label.textContent = state.loading ? `${name} · 加载中` : name;
    for (const button of [byId("mobileRoomPrev"), byId("mobileRoomNext")]) {
      if (button) button.disabled = !!state.loading || buttons.length < 2;
    }
  };
  const changeCostume = (direction) => {
    if (!mobile || !enter()) return;
    const state = window.AnonLive2D?.getState?.() || {};
    if (state.loading) return;
    const buttons = Array.from(costumeHost?.querySelectorAll("button[data-value]") || []);
    if (buttons.length < 2) return;
    let index = buttons.findIndex((button) => button.classList.contains("is-active") || button.getAttribute("aria-pressed") === "true");
    if (index < 0) index = buttons.findIndex((button) => button.dataset.value === state.costume);
    if (index < 0) index = 0;
    buttons[(index + direction + buttons.length) % buttons.length].click();
    syncCostume();
  };
  function updateViewport() {
    viewportFrame = 0;
    if (!mobile) return;
    const viewport = window.visualViewport;
    const height = viewport?.height || window.innerHeight;
    const top = viewport?.offsetTop || 0;
    const editing = room.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
    const layoutHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
    if (!editing) unobscuredHeight = layoutHeight;
    const coveredHeight = Math.max(0, Math.max(layoutHeight, unobscuredHeight) - height);
    const inset = Math.max(0, coveredHeight - top);
    // Safari 聚焦时还会平移视觉视口；判定键盘只比较高度，避免 offsetTop 抵消键盘占高。
    const keyboard = editing && (viewport?.scale || 1) < 1.1 && coveredHeight > 140;
    room.style.setProperty("--room-viewport-height", `${height}px`);
    room.style.setProperty("--room-viewport-top", `${top}px`);
    room.style.setProperty("--room-keyboard-inset", `${keyboard ? inset : 0}px`);
    room.classList.toggle("is-keyboard-open", keyboard);
  }
  function scheduleViewport() {
    if (!viewportFrame && mobile) viewportFrame = window.requestAnimationFrame(updateViewport);
  }
  const syncPreferences = () => {
    const summary = preferences?.querySelector("summary");
    if (summary) summary.textContent = `${byId("anonChatMode")?.value === "deepseek" ? "DeepSeek AI" : "本地互动"} · 设置与说明`;
    preferencesButton?.setAttribute("aria-expanded", String(mobile && !!preferences?.open));
  };
  const setMobile = () => {
    if (mobile === media.matches) { scheduleViewport(); return; }
    mobile = media.matches;
    if (mobile) {
      detailsState = { model: modelSettings?.open, chat: preferences?.open, controlsLabel: controls.getAttribute("aria-label") };
      if (modelSettings) modelSettings.open = true;
      if (preferences) preferences.open = false;
      if (zoom && zoomHost) zoomHost.appendChild(zoom);
      room.classList.add("mobile-room");
      panel = dialogOpen() ? "chat" : "closed";
      syncPanel();
      syncPreferences();
      syncCostume();
      updateViewport();
      // 手机首次打开即是全屏舞台；同一断点内退出后，普通 resize 不会重新进入。
      if (enter(true) && !dialogOpen()) focus(byId("mobileRoomBack"));
    } else {
      exit();
      room.classList.remove("mobile-room", "is-keyboard-open");
      room.removeAttribute("data-panel");
      for (const [element, state] of savedAccess) restoreAttributes(element, state);
      savedAccess.clear();
      if (zoom && zoomMarker.parentNode) zoomMarker.after(zoom);
      if (modelSettings && detailsState) modelSettings.open = detailsState.model;
      if (preferences && detailsState) preferences.open = detailsState.chat;
      preferencesButton?.setAttribute("aria-expanded", "false");
      if (detailsState?.controlsLabel == null) controls.removeAttribute("aria-label");
      else controls.setAttribute("aria-label", detailsState.controlsLabel);
      detailsState = null;
      for (const element of [...Object.values(panelButtons), prompt]) element?.setAttribute("aria-expanded", "false");
      for (const element of Object.values(panelTabs)) element?.setAttribute("aria-pressed", "false");
      for (const name of viewportProperties) room.style.removeProperty(name);
      if (viewportFrame) window.cancelAnimationFrame(viewportFrame);
      viewportFrame = 0;
      unobscuredHeight = 0;
    }
  };
  chatButton?.addEventListener("click", () => openPanel("chat"));
  prompt?.addEventListener("click", () => openPanel("chat"));
  toolsButton?.addEventListener("click", () => openPanel("tools"));
  expressionsButton?.addEventListener("click", () => openPanel("expressions"));
  motionsButton?.addEventListener("click", () => openPanel("motions"));
  byId("mobileRoomPanelHeading")?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-room-panel]");
    if (tab) setPanel(tab.dataset.roomPanel, true);
  });
  byId("mobileRoomClose")?.addEventListener("click", () => setPanel("closed", true));
  preferencesButton?.addEventListener("click", () => {
    if (!mobile || panel !== "chat" || !preferences) return;
    preferences.open = !preferences.open;
    syncPreferences();
  });
  preferences?.addEventListener("toggle", syncPreferences);
  byId("mobileRoomPrev")?.addEventListener("click", () => changeCostume(-1));
  byId("mobileRoomNext")?.addEventListener("click", () => changeCostume(1));
  fullscreen?.addEventListener("click", () => {
    if (!mobile) return;
    if (immersive) { setPanel("closed"); exit(); }
    else if (enter()) focus(fullscreen);
  });
  byId("mobileRoomBack")?.addEventListener("click", () => {
    if (!mobile) return;
    if (immersive) { setPanel("closed"); exit(false); }
    browseProfile();
  });
  document.addEventListener("click", (event) => {
    if (!mobile || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a[href]");
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || url.search !== window.location.search || url.hash !== "#live2d") return;
    event.preventDefault();
    if (enter()) focus(byId("mobileRoomBack"));
  }, true);
  document.addEventListener("keydown", (event) => {
    if (!mobile || event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open], .lightbox:not([hidden])")) return;
    if (panel !== "closed") { event.preventDefault(); setPanel("closed", true); }
    else if (immersive) { event.preventDefault(); exit(); }
  });
  document.addEventListener("focusin", (event) => {
    if (mobile && event.target === input) openPanel("chat", false);
    scheduleViewport();
  });
  document.addEventListener("focusout", scheduleViewport);
  byId("anonChatMode")?.addEventListener("change", syncPreferences);
  const disclosure = byId("chatDisclosure");
  if (disclosure) new MutationObserver(syncPreferences).observe(disclosure, { childList: true, subtree: true, characterData: true });
  window.addEventListener("anon:live2d-state", (event) => syncCostume(event.detail));
  window.addEventListener("resize", scheduleViewport, { passive: true });
  window.addEventListener("orientationchange", () => { unobscuredHeight = 0; scheduleViewport(); }, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleViewport, { passive: true });
  window.visualViewport?.addEventListener("scroll", scheduleViewport, { passive: true });
  if (media.addEventListener) media.addEventListener("change", setMobile);
  else media.addListener(setMobile);
  window.AnonMobileRoom = {
    isActive: () => mobile,
    prepareChat: () => {
      if (!mobile) return false;
      openPanel("chat", false);
      input?.blur();
      scheduleViewport();
      return true;
    },
  };
  setMobile();
})();
