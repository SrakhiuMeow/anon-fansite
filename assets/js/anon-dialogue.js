/* 同人对话：本地预设始终可用；DeepSeek 经同源服务端调用，浏览器不持有 API Key。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (!root?.document) return;
  root.AnonDialogue = api;
  const form = root.document.getElementById("anonChatForm");
  const input = root.document.getElementById("anonChatInput");
  const log = root.document.getElementById("anonChatLog");
  const state = root.document.getElementById("anonChatState");
  if (!form || !input || !log) return;
  const mode = root.document.getElementById("anonChatMode");
  const disclosure = root.document.getElementById("chatDisclosure");
  const stop = root.document.getElementById("anonChatStop");
  const clear = root.document.getElementById("anonChatClear");
  const access = root.document.getElementById("anonChatAccessCode");
  const accessDialog = root.document.getElementById("anonChatAccessDialog");
  const accessForm = root.document.getElementById("anonChatAccessForm");
  const accessError = root.document.getElementById("anonChatAccessError");
  const accessSubmit = root.document.getElementById("anonChatAccessSubmit");
  const accessCancel = root.document.getElementById("anonChatAccessCancel");
  const unlock = root.document.getElementById("anonChatUnlock");
  const lock = root.document.getElementById("anonChatLock");
  const emotion = root.document.getElementById("anonChatEmotion");
  const send = form.querySelector('[type="submit"]');
  const prompts = [...root.document.querySelectorAll("[data-chat-prompt]")];
  let history = [];
  let request = 0;
  let controller = null;
  let busy = false;
  let modeChosen = false;
  let requiresCode = false;
  // 口令只保留在当前页面闭包中，不写入浏览器存储或页面文本。
  let accessCode = "";
  let unlockRequest = 0;
  let unlockController = null;
  let reactionRequest = 0;
  const setState = (text) => { if (state) state.textContent = text; };
  const setBusy = (value) => {
    busy = value;
    if (send) send.disabled = value;
    prompts.forEach((button) => { button.disabled = value; });
    if (stop) stop.hidden = !value;
    log.setAttribute("aria-busy", String(value));
  };
  const syncMode = () => {
    const ai = mode?.value === "deepseek";
    if (disclosure) disclosure.textContent = ai
      ? "DeepSeek 驱动的非官方角色扮演。发送后，本条消息与最近几轮 AI 对话将经服务端交给 DeepSeek；本页不持久保存，刷新或清空即可重置。"
      : "本站原创的本地关键词互动，非官方台词。此模式不上传聊天内容，刷新即清空。";
    if (unlock) unlock.hidden = !ai || !requiresCode || !!accessCode;
    if (lock) lock.hidden = !ai || !requiresCode || !accessCode;
  };
  const resetUnlock = () => {
    ++unlockRequest;
    unlockController?.abort(); unlockController = null;
    if (access) { access.value = ""; access.disabled = false; }
    if (accessSubmit) { accessSubmit.disabled = false; accessSubmit.textContent = "解锁 AI 聊天"; }
  };
  const closeUnlock = () => { resetUnlock(); if (accessDialog?.open) accessDialog.close(); };
  const openUnlock = (message = "") => {
    if (mode?.value !== "deepseek" || !requiresCode || accessCode) return;
    if (accessError) accessError.textContent = message;
    if (!accessDialog?.open) accessDialog?.showModal();
    access?.focus();
  };
  accessForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (unlockController || !accessDialog?.open || mode?.value !== "deepseek") return;
    const password = access?.value || "";
    if (!password) { accessError.textContent = "请输入聊天密码。"; access?.focus(); return; }
    const version = ++unlockRequest;
    const active = new AbortController(); unlockController = active;
    access.disabled = true; accessSubmit.disabled = true; accessSubmit.textContent = "正在验证…";
    accessError.textContent = "";
    const timeout = setTimeout(() => active.abort("timeout"), 10000);
    try {
      const response = await root.fetch("/api/chat", {
        method: "POST", signal: active.signal,
        headers: { "Content-Type": "application/json", "X-Chat-Access-Code": encodeURIComponent(password) },
        body: JSON.stringify({ action: "unlock" }),
      });
      const result = await response.json().catch(() => ({}));
      if (version !== unlockRequest || mode?.value !== "deepseek" || !accessDialog?.open) return;
      if (active.signal.aborted) throw new Error("验证超时，请重试。");
      if (!response.ok || result.unlocked !== true) {
        throw new Error(response.status === 401 ? "密码不正确，请重新输入。" : response.status === 429 ? "尝试过于频繁，请稍后再试。" : "暂时无法验证密码，请稍后重试。");
      }
      accessCode = password;
      closeUnlock(); syncMode();
      setState("AI 聊天已解锁。本次页面有效，刷新或重新锁定后需要再次输入密码。");
      input.focus();
    } catch (error) {
      if (version !== unlockRequest) return;
      access.value = "";
      accessError.textContent = active.signal.reason === "timeout" ? "验证超时，请重试。" : error.message;
    } finally {
      clearTimeout(timeout);
      if (version === unlockRequest) {
        unlockController = null; access.disabled = false; accessSubmit.disabled = false; accessSubmit.textContent = "解锁 AI 聊天"; access.focus();
      }
    }
  });
  accessCancel?.addEventListener("click", closeUnlock);
  accessDialog?.addEventListener("cancel", (event) => { event.preventDefault(); closeUnlock(); });
  accessDialog?.addEventListener("close", () => { if (!accessDialog.open) resetUnlock(); });
  unlock?.addEventListener("click", () => openUnlock());
  const append = (role, text) => {
    const item = root.document.createElement("p");
    item.className = `chat-message chat-message--${role}`;
    const label = root.document.createElement("strong");
    label.textContent = role === "user" ? "你 · " : "爱音 · ";
    const content = root.document.createElement("span");
    content.textContent = text;
    item.append(label, content);
    log.appendChild(item);
    while (log.children.length > 40) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
    return content;
  };
  const abortable = (task, signal) => {
    if (!signal) return Promise.resolve(task);
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => { signal.removeEventListener("abort", abort); callback(value); };
      const abort = () => finish(reject, new Error("对话已取消"));
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(task).then((value) => finish(resolve, value), (error) => finish(reject, error));
      if (signal.aborted) abort();
    });
  };
  const pausePlayback = (ms, signal) => {
    let timer;
    return abortable(new Promise((resolve) => { timer = setTimeout(resolve, Math.max(0, ms)); }), signal)
      .finally(() => clearTimeout(timer));
  };
  const react = async (result, signal) => {
    if (signal?.aborted) return;
    const version = ++reactionRequest;
    const turn = request;
    const label = result.label || "平静待机";
    if (emotion) { emotion.textContent = `回应：${label}…`; emotion.title = "正在应用对应的 Live2D 表情与动作"; }
    try {
      const outcome = await abortable(root.AnonLive2D?.react(signal ? { ...result, signal } : result), signal);
      if (signal?.aborted || version !== reactionRequest || turn !== request) return;
      if (emotion) {
        const performance = outcome?.ok && outcome.mode === "performance" && outcome.expression === "";
        const actionLabel = typeof outcome?.actionLabel === "string" && outcome.actionLabel.trim() ? outcome.actionLabel : "演奏姿态";
        emotion.textContent = performance ? `回应：${actionLabel}` : outcome?.ok ? `回应：${label}` : `回应：${label} · 未播放`;
        emotion.title = performance ? `本轮语气：${label}。已触发舞台动作：${actionLabel}；当前演奏模型没有独立表情。` : outcome?.ok ? "已应用对应的 Live2D 表情与动作" : outcome?.reason || "模型暂未就绪";
      }
    } catch {
      if (!signal?.aborted && version === reactionRequest && turn === request && emotion) {
        emotion.textContent = `回应：${label} · 暂不可用`;
        emotion.title = "模型动作未能应用，请检查模型加载状态";
      }
    }
  };
  const cancel = () => {
    controller?.abort();
    ++reactionRequest;
    if (root.AnonLive2D?.getState?.().ready) void react({ motion: "idle01", expression: "default", label: "平静待机", source: "control" });
    else if (emotion) { emotion.textContent = "随对话变化"; emotion.title = "对话会自动选择对应表情与动作"; }
  };
  const submit = async (raw) => {
    if (busy) return;
    const result = api.reply(raw);
    if (!result) { input.focus(); return; }
    const useAI = mode?.value === "deepseek";
    if (useAI && requiresCode && !accessCode) {
      setState("AI 聊天已锁定，请先输入密码解锁。");
      openUnlock();
      return;
    }
    const version = ++request;
    const text = api.normalize(raw);
    append("user", text);
    input.value = "";
    setBusy(true);
    const active = new AbortController();
    controller = active;
    // 手机将画面带回模型与最新回复，收起软键盘；两个面板不会互相遮挡。
    if (root.matchMedia?.("(max-width: 700px)").matches) {
      input.blur();
      const controls = root.document.querySelector(".l2d-controls");
      if (controls) controls.scrollTop = 0;
      root.document.getElementById("anonRoom")?.scrollIntoView({ block: "start", behavior: "instant" });
      await new Promise((resolve) => root.requestAnimationFrame(() => root.requestAnimationFrame(resolve)));
    }
    if (version !== request) return;
    if (active.signal.aborted) {
      setState("已停止，本次内容不会加入后续对话记忆。");
      setBusy(false); controller = null;
      return;
    }
    if (!useAI) {
      append("anon", result.text);
      react({ ...result, source: "chat" }, active.signal);
      setState(`本地互动：${result.label}。对话为本站原创同人内容。`);
      setBusy(false);
      controller = null;
      return;
    }
    setState("爱音正在想怎么回答…");
    react({ motion: "thinking01", expression: "thinking01", label: "思考", source: "chat" }, active.signal);
    let content = null;
    let answer = "";
    let complete = false;
    const reducedMotion = !!root.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let segment = "";
    let segmentStarted = 0;
    let lastReaction = null;
    let lastReactionAt = 0;
    let continuations = 0;
    const requireCurrent = () => { if (version !== request || active.signal.aborted) throw new Error("对话已取消"); };
    // 45 秒服务端期限之外，为最多 1000 字的渐进显示留出时间。
    const timeout = setTimeout(() => active.abort("timeout"), 75000);
    try {
      const context = history.slice(-10);
      // 按服务端预算保留完整轮次；极长回答时可少于五轮。
      while (context.length && context.reduce((size, item) => size + item.content.length, text.length) > 6000) context.splice(0, 2);
      const response = await root.fetch("/api/chat", {
        method: "POST", signal: active.signal,
        headers: { "Content-Type": "application/json", ...(requiresCode ? { "X-Chat-Access-Code": encodeURIComponent(accessCode) } : {}) },
        body: JSON.stringify({ messages: [...context, { role: "user", content: text }] }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (response.status === 401) throw Object.assign(new Error("密码已失效，请重新解锁 AI 聊天。"), { accessDenied: true });
        throw new Error(error.error || "AI 服务暂时不可用");
      }
      if (!response.headers.get("content-type")?.includes("application/x-ndjson") || !response.body) throw new Error("AI 服务返回格式异常");
      await api.readEvents(response.body, async (event) => {
        requireCurrent();
        if (event.type === "reaction") {
          const reaction = { ...event, source: "chat" };
          const nextSegment = `${event.emotion || ""}|${event.motion}|${event.expression}`;
          if (nextSegment !== segment) {
            // 同一网络块中的多段情绪也依序播放；只在切换情绪时保证停留。
            const remaining = segment ? 700 - (Date.now() - segmentStarted) : 0;
            if (!reducedMotion && remaining > 0) await pausePlayback(remaining, active.signal);
            requireCurrent();
            await react(reaction, active.signal);
            requireCurrent();
            segment = nextSegment;
            segmentStarted = Date.now();
            lastReactionAt = segmentStarted;
          }
          lastReaction = reaction;
        }
        if (event.type === "delta" && typeof event.text === "string") {
          const text = event.text.slice(0, 1000 - answer.length);
          const pieces = reducedMotion ? [text] : Array.from(text);
          for (const piece of pieces) {
            requireCurrent();
            if (!piece) continue;
            answer += piece;
            if (!content) content = append("anon", "");
            content.textContent = answer;
            log.scrollTop = log.scrollHeight;
            setState("爱音正在回复…");
            if (!reducedMotion) {
              await pausePlayback(20, active.signal);
              requireCurrent();
              // 长段落在自然句读处延续同一语气；无后台计时器，文字结束即停止续接。
              if (lastReaction && continuations < 3 && Date.now() - lastReactionAt >= 4500 && /[。！？；，、….!?;,]/u.test(piece)) {
                await react({ ...lastReaction, continuation: true }, active.signal);
                requireCurrent();
                lastReactionAt = Date.now();
                continuations += 1;
              }
            }
          }
        }
        if (event.type === "done") complete = true;
        if (event.type === "error") throw new Error(event.message || "AI 回复中断");
      }, active.signal);
      if (version !== request) return;
      if (active.signal.aborted || !complete || !answer.trim()) throw new Error("AI 回复未完成");
      history.push({ role: "user", content: text }, { role: "assistant", content: answer });
      history = history.slice(-10);
      setState("DeepSeek 回复完成 · 非官方同人演绎");
    } catch (error) {
      if (version !== request) return;
      if (error.accessDenied && !active.signal.aborted) {
        accessCode = ""; requiresCode = true; history = []; cancel();
        input.value = text; syncMode(); setState(error.message); openUnlock(error.message);
      } else if (active.signal.aborted && active.signal.reason !== "timeout") {
        if (!answer) append("anon", "（已停止本次回复）");
        setState("已停止，本次内容不会加入后续对话记忆。");
      } else if (answer) {
        setState("AI 回复中断，已保留收到的文字；本次内容未加入对话记忆。");
      } else {
        append("anon", result.text);
        react({ ...result, source: "chat" });
        setState(`${active.signal.reason === "timeout" ? "AI 回复超时" : error.message.replace(/[。；;\s]+$/u, "")}；本次使用本地预设回复。`);
      }
    } finally {
      clearTimeout(timeout);
      if (version === request) { setBusy(false); controller = null; }
    }
  };
  form.addEventListener("submit", (event) => { event.preventDefault(); void submit(input.value); });
  append("anon", "欢迎来到我的应援小房间！试着打个招呼，或对我说「眨眼」吧。");
  prompts.forEach((button) => button.addEventListener("click", () => { void submit(button.dataset.chatPrompt); }));
  stop?.addEventListener("click", cancel);
  clear?.addEventListener("click", () => {
    ++request; cancel(); controller = null; history = []; log.replaceChildren(); setBusy(false);
    append("anon", "从这里重新开始吧！今天想聊什么？");
    setState("已清空本页聊天记录与对话记忆。");
  });
  lock?.addEventListener("click", () => {
    ++request; cancel(); controller = null; history = []; accessCode = ""; closeUnlock(); setBusy(false); syncMode();
    setState("AI 聊天已重新锁定，对话记忆已清空。本地互动仍可使用。");
  });
  mode?.addEventListener("change", () => {
    modeChosen = true; ++request; cancel(); controller = null; history = []; accessCode = ""; closeUnlock(); setBusy(false); syncMode();
    setState("已切换模式，对话记忆已重置。");
    if (mode.value === "deepseek") openUnlock();
  });
  syncMode();
  // 仅检查服务状态，不上传对话；普通静态服务器没有此接口时仍可本地互动。
  if (/^https?:$/.test(root.location.protocol)) {
    root.fetch("/api/chat", { signal: AbortSignal.timeout(5000), cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((config) => {
        if (!config?.enabled || !mode) return;
        requiresCode = !!config.accessCodeRequired;
        mode.querySelector('[value="deepseek"]').disabled = false;
        if (!modeChosen && !busy) mode.value = "deepseek";
        syncMode();
      }).catch(() => {});
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const normalize = (value) => String(value ?? "").normalize("NFKC").trim().slice(0, 200);
  const response = (text, motion, expression, label) => ({ text, motion, expression, label });
  const commands = [
    [/微笑|笑一[个下]|笑笑|smile/i, "笑一下的话，气氛是不是就轻松多了？", "smile01", "微笑"],
    [/眨眼|wink/i, "收到！这个 Wink，就送给屏幕前的你啦。", "wink01", "眨眼"],
    [/挥手|招手/, "喂——这边这边！很高兴在这里见到你。", "bye01", "挥手"],
    [/害羞|脸红/, "突然这样说，我也会有点不好意思的嘛……", "shame01", "害羞"],
    [/惊讶|吃惊/, "诶？还有这种事！快讲给我听听。", "surprised01", "吃惊"],
    [/生气|愤怒/, "哼——这个生气的表情，有没有一点气势？", "angry01", "生气"],
    [/哭一[个下]|哭泣|哭哭/, "这是哭泣表情演示。看完了，我们再换个开心的话题吧。", "cry01", "哭泣"],
    [/思考|想一想/, "嗯……给我一点点时间，办法总会有的。", "thinking01", "思考"],
    [/摆[个]?姿势|pose/i, "镜头准备好了？那就，记录下这一刻吧！", "kime01", "摆姿势"],
    [/默认|待机|重置表情/, "好啦，恢复平常的样子。接下来想聊什么？", "idle01", "待机"],
  ];
  const reply = (value) => {
    const text = normalize(value);
    if (!text) return null;
    // 否定指令先于正向关键词，避免“不要哭 / 别生气”触发对应动作。
    if (/(?:不要|别|不想|不许|不用|不能|不准).{0,4}(?:笑|眨眼|挥手|哭|生气|动作|表情)/u.test(text)) {
      return response("好，听你的。我们放轻松，慢慢聊就好。", "idle01", "default", "平静待机");
    }
    if (/不开心|不高兴|难过|失落|好累|疲[惫倦]|压力|焦虑|失败|鼓励|加油/u.test(text)) {
      return response("今天已经很努力了吧。先给自己一点休息的时间，下一小步，我们再慢慢来。", "kandou01", "smile01", "为你打气");
    }
    if (/不喜欢|讨厌你|不可爱|不好看|不漂亮/u.test(text)) {
      return response("嗯，每个人喜欢的东西都不一样。要不换个话题，聊聊音乐？", "thinking01", "default", "认真倾听");
    }
    for (const [pattern, answer, motion, label] of commands) {
      if (pattern.test(text)) return response(answer, motion, motion === "idle01" ? "default" : motion, label);
    }
    if (/生日|birthday/i.test(text)) return response("我的生日是 9 月 8 日！你愿意记住这一天，我会很开心的。", "smile02", "smile01", "生日话题");
    if (/吉他|练[琴习]|guitar|乐队|mygo/i.test(text)) return response("吉他还要继续练习呢。把难的地方拆成一小段，一遍一遍来——一起把喜欢的声音弹出来吧！", "serious01", "smile01", "吉他话题");
    if (/再见|拜拜|晚安|bye|good\s*night/i.test(text)) return response("今天能和你聊天真好。路上小心，下次再见啦！", "bye01", "smile01", "挥手告别");
    if (/可爱|好看|漂亮|喜欢你|最棒|夸夸|谢谢|thank/i.test(text)) return response("嘿嘿，被你这样说，今天的心情都变好了。谢谢你来这里陪我！", "shame01", "shame01", "害羞回应");
    if (/你好|您好|早[上安]|午[好安]|晚上好|嗨|hello|\bhi\b|初次见面/i.test(text)) return response("你好呀！我是爱音。今天想聊聊吉他，还是看看我的新表情？", "bye01", "smile01", "打个招呼");
    return response("我在听哦！这里的我只会一些预先写好的回应。可以试试「给我加油」「眨眼」或「聊聊吉他」。", "thinking01", "default", "认真倾听");
  };
  // 网络分块可落在任意 UTF-8 字符或换行处；只处理完整 NDJSON 事件。
  const readEvents = async (body, onEvent, signal) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const consume = async (line) => {
      if (signal?.aborted) throw new Error("对话已取消");
      if (line.trim()) await onEvent(JSON.parse(line));
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        if (buffer.length > 65536) throw new Error("AI 响应超出限制");
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          await consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
        }
        if (done) { await consume(buffer); break; }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  };
  return { normalize, reply, readEvents };
});
