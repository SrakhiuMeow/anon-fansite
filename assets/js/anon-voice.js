/* 爱音日语合成语音：完整 AI 正文由服务端转为日语朗读，聊天原文保持不变。 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AnonVoice = api;
})(typeof window !== "undefined" ? window : null, function (root) {
  "use strict";
  const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
  const MAX_CACHE_BYTES = 12 * 1024 * 1024;
  // 语音方案偏好存在本机；服务端下发的白名单才是最终依据。
  const PROVIDER_STORAGE = "anon-voice-provider";
  const DEFAULT_PROVIDER = "fish";
  // 单块方案要排公开推理队列，客户端等得比 Fish 久一点，但仍短于服务端 75 秒内部超时。
  const TIMEOUTS = { fish: 70000, vits2: 85000 };
  // 一小段静音用于在点击事件内激活播放器；浏览器仍拒绝时保留手动播放入口。
  const SILENCE = "data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA";

  function create(options = {}) {
    const host = options.host || root;
    if (!host?.document) return null;
    const doc = host.document;
    const toggle = doc.getElementById("anonVoiceAuto");
    const status = doc.getElementById("anonVoiceStatus");
    const providerSelect = doc.getElementById("anonVoiceProvider");
    const getAccessCode = options.getAccessCode || (() => "");
    const records = new Set();
    const cache = new Map();
    let cacheBytes = 0;
    let context = { ai: false, unlocked: false, busy: false };
    let providers = [];
    let provider = DEFAULT_PROVIDER;
    let storedProvider = "";
    try { storedProvider = host.localStorage?.getItem(PROVIDER_STORAGE) || ""; } catch { /* 隐私模式下用默认方案 */ }
    let checked = false;
    let automatic = false;
    let pendingAuto = null;
    let version = 0;
    let active = null;
    let controller = null;
    let audio;
    let detachAudio = () => {};
    try { audio = new host.Audio(); audio.preload = "auto"; } catch { /* 无音频能力仍可聊天。 */ }

    const currentProvider = () => providers.find((item) => item.id === provider) || null;
    // 只有当前选中的方案可用时才算可用，避免选到未配置的方案仍显示可播。
    const available = () => !!audio && !!currentProvider()?.available;
    const allowsAuto = () => currentProvider()?.auto === true;
    const allowed = () => available() && context.ai && context.unlocked && !context.busy && !doc.hidden;
    const cacheKey = (text) => `${provider}\u0000${text}`;
    const connected = (record) => record.element.isConnected !== false;

    const draw = () => {
      const spec = currentProvider();
      // 单块方案要排公开队列约一分钟，自动朗读会卡住对话，因此这类方案一律不开自动。
      if (automatic && !allowsAuto()) { automatic = false; pendingAuto = null; }
      if (toggle) {
        toggle.hidden = !context.ai;
        toggle.disabled = !allowed() || !allowsAuto();
        toggle.textContent = `自动朗读：${automatic ? "开" : "关"}`;
        toggle.title = allowsAuto()
          ? "默认关闭；开启后用日语朗读本页后续完整 AI 回复，聊天原文保持不变"
          : "当前语音方案一次只朗读开头且需要排队，因此不提供自动朗读";
        toggle.setAttribute("aria-checked", String(automatic));
      }
      if (providerSelect) {
        const usable = providers.filter((item) => item.available);
        providerSelect.hidden = !context.ai || providers.length < 2;
        providerSelect.disabled = !context.ai || usable.length < 2 || !!active;
        if (providerSelect.value !== provider) providerSelect.value = provider;
      }
      if (status) {
        status.hidden = !context.ai;
        status.textContent = !audio ? "此浏览器暂不支持语音播放。" : !checked ? "正在检查语音服务…"
          : !spec?.available ? "当前语音方案待配置，可在设置里换用其他方案；文字聊天仍可使用。"
          : spec.auto ? `千早爱音 · 日语 AI合成音色。仅将这条 AI 回复交给 DeepSeek 转成日语，再由 ${spec.name} 合成；聊天原文不变，自动朗读默认关闭。`
          : `千早爱音 · 日语 AI合成音色（${spec.name}）。公开推理队列，一次只朗读开头，约需数十秒，不支持自动朗读。`;
      }
      for (const record of records) {
        const playing = active?.record === record;
        record.button.disabled = !playing && !allowed();
        record.button.textContent = playing ? "停止语音" : cache.has(cacheKey(record.text)) ? "重播日语" : "播放日语";
        record.button.setAttribute("aria-label", playing ? "停止本条日语语音" : "以爱音合成音色用日语朗读本条回复，保留聊天原文");
        record.button.setAttribute("aria-pressed", String(playing));
      }
    };
    const removeClip = (cacheId) => {
      const clip = cache.get(cacheId);
      if (!clip) return;
      host.URL.revokeObjectURL(clip.url);
      cacheBytes -= clip.size;
      cache.delete(cacheId);
    };
    const prune = () => {
      for (const record of records) if (!connected(record)) {
        if (active?.record === record) stop();
        if (pendingAuto === record) pendingAuto = null;
        records.delete(record);
      }
      for (const cacheId of cache.keys()) if (![...records].some((record) => cacheKey(record.text) === cacheId)) removeClip(cacheId);
    };
    const resetAudio = () => {
      detachAudio(); detachAudio = () => {};
      try { audio?.pause(); audio?.removeAttribute("src"); audio?.load(); } catch {}
    };
    function stop() {
      ++version;
      controller?.abort(); controller = null;
      pendingAuto = null;
      if (active) active.record.state.textContent = "已停止";
      active = null;
      resetAudio();
      draw();
    }
    const prime = () => {
      if (!audio) return;
      const current = version;
      try {
        audio.src = SILENCE;
        Promise.resolve(audio.play()).then(() => {
          if (version === current && audio.src === SILENCE) audio.pause();
        }).catch(() => {});
      } catch {}
    };
    const keepClip = (cacheId, blob) => {
      const clip = { url: host.URL.createObjectURL(blob), size: blob.size };
      removeClip(cacheId);
      cache.set(cacheId, clip); cacheBytes += blob.size;
      for (const key of cache.keys()) {
        if (cache.size <= 5 && cacheBytes <= MAX_CACHE_BYTES) break;
        if (key !== cacheId) removeClip(key);
      }
      return clip;
    };
    const readAudio = async (response, signal) => {
      if (Number(response.headers.get("content-length")) > MAX_AUDIO_BYTES) throw new Error("语音文件过大，请重试。");
      // 服务端按方案决定容器：Fish 出 mp3，Bangstarlight 出 wav。
      const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!["audio/mpeg", "audio/mp3", "audio/x-wav", "audio/wav", "audio/wave"].includes(type)) throw new Error("语音返回格式异常，请重试。");
      if (!/^ja(?:-|$)/i.test(response.headers.get("content-language") || "")) throw new Error("语音语言未确认，请刷新后重试。");
      if (!response.body?.getReader) throw new Error("语音返回格式异常，请重试。");
      const reader = response.body.getReader();
      const pieces = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (signal.aborted) throw new Error("cancelled");
          if (done) break;
          size += value.byteLength;
          if (size > MAX_AUDIO_BYTES) throw new Error("语音文件过大，请重试。");
          pieces.push(value);
        }
        if (!size) throw new Error("没有收到语音，请重试。");
        return new host.Blob(pieces, { type: type === "audio/mpeg" || type === "audio/mp3" ? "audio/mpeg" : "audio/wav" });
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    };
    const play = async (record, gesture = false) => {
      if (active?.record === record) { stop(); return; }
      if (!allowed() || !connected(record)) return;
      stop(); prune();
      const activeProvider = provider;
      const cacheId = cacheKey(record.text);
      let truncated = false;
      const current = version;
      const task = new host.AbortController();
      controller = task;
      active = { record };
      if (gesture) prime();
      record.state.textContent = cache.has(cacheId) ? "准备播放日语…" : "正在翻译并生成日语语音…";
      draw();
      const timeout = host.setTimeout(() => task.abort("timeout"), TIMEOUTS[activeProvider] || 70000);
      const requireCurrent = () => {
        if (current !== version || task.signal.aborted || !connected(record) || !allowed()) throw new Error("cancelled");
      };
      try {
        let clip = cache.get(cacheId);
        if (!clip) {
          const response = await host.fetch("/api/tts", {
            method: "POST", signal: task.signal,
            headers: { "Content-Type": "application/json", "X-Chat-Access-Code": encodeURIComponent(getAccessCode()) },
            body: JSON.stringify({ text: record.text, provider: activeProvider }),
          });
          requireCurrent();
          if (!response.ok) {
            // 仅识别本站固定错误码，供应商正文和任意服务端文案不进入 DOM。
            let code = "";
            if (/^application\/json(?:;|$)/i.test(response.headers.get("content-type") || "")) {
              try { code = (await response.json())?.code; } catch {}
              requireCurrent();
            }
            await response.body?.cancel().catch(() => {});
            if (response.status === 401) throw new Error("请重新解锁 AI 聊天后播放。");
            if (response.status === 429) throw new Error("语音请求较多，请稍后再试。");
            if (code === "VOICE_NOT_CONFIGURED") throw new Error("该语音方案尚未配置，请换一个方案。");
            if (code === "VOICE_TIMEOUT") throw new Error("语音方案排队较久，请稍后重试。");
            if (code === "VOICE_TRANSLATION_UNAVAILABLE") throw new Error("日语翻译服务暂不可用，请站长检查配置。聊天原文已保留。");
            if (code === "VOICE_TRANSLATION_FAILED") throw new Error("日语翻译失败，请重试语音。聊天原文已保留。");
            if (code === "VOICE_AUTH_FAILED") throw new Error("语音服务密钥不可用，请站长检查配置。");
            if (code === "VOICE_ACCESS_DENIED") throw new Error("语音模型或音色访问受限，请站长检查权限。");
            if (code === "VOICE_CREDIT_REQUIRED") throw new Error("语音服务暂不满足免费调用条件，请站长检查账号状态。");
            if (code === "VOICE_NOT_FOUND") throw new Error("语音音色暂不可用，请站长检查音色配置。");
            if (response.status === 503 || response.status === 504) throw new Error("语音服务暂不可用，请稍后再试。");
            throw new Error("语音生成失败，请重试。");
          }
          truncated = response.headers.get("X-Voice-Truncated") === "1";
          const blob = await readAudio(response, task.signal);
          requireCurrent();
          clip = keepClip(cacheId, blob);
        }
        requireCurrent();
        host.clearTimeout(timeout);
        audio.src = clip.url;
        const finish = (failed = false) => {
          if (current !== version || active?.record !== record) return;
          record.state.textContent = failed ? "播放失败，可重试。" : truncated ? "播放完毕 · 本方案只朗读开头" : "播放完毕";
          if (failed) removeClip(cacheId);
          active = null; controller = null;
          resetAudio(); draw();
        };
        const ended = () => finish();
        const failed = () => finish(true);
        audio.addEventListener("ended", ended);
        audio.addEventListener("error", failed);
        detachAudio = () => { audio.removeEventListener("ended", ended); audio.removeEventListener("error", failed); };
        await audio.play();
        if (current !== version || active?.record !== record) return;
        requireCurrent();
        record.state.textContent = "正在播放 · 日语 · AI合成";
      } catch (error) {
        if (current !== version) return;
        record.state.textContent = error?.name === "NotAllowedError" ? "语音已就绪，请点击重播。"
          : task.signal.reason === "timeout" ? "语音生成超时，请重试。"
          : task.signal.aborted ? "已停止"
          : error.message === "cancelled" ? "已停止" : /^语音|^日语|^请重新|^没有收到/.test(error.message) ? error.message : "语音播放失败，请重试。";
        task.abort();
        active = null; controller = null;
        resetAudio(); draw();
      } finally { host.clearTimeout(timeout); }
    };
    const addReply = (element, text) => {
      if (!element || typeof text !== "string" || !text.trim() || text.length > 1000) return;
      prune();
      if ([...records].some((record) => record.element === element)) return;
      const row = doc.createElement("div"); row.className = "chat-voice";
      const button = doc.createElement("button"); button.type = "button"; button.className = "chip chat-voice-button";
      const state = doc.createElement("span"); state.className = "chat-voice-state"; state.setAttribute("role", "status");
      const record = { element, row, button, state, text };
      button.addEventListener("click", () => { void play(record, true); });
      row.append(button, state); element.appendChild(row); records.add(record);
      while (records.size > 40) {
        const first = records.values().next().value;
        if (active?.record === first) stop();
        first.row.remove(); records.delete(first);
      }
      if (automatic && context.ai && context.unlocked && !doc.hidden) pendingAuto = record;
      draw();
      if (pendingAuto && allowed()) { const next = pendingAuto; pendingAuto = null; void play(next); }
    };
    const sync = (next) => {
      context = { ...context, ...next };
      if ((!context.ai || !context.unlocked) && (active || pendingAuto)) stop();
      else if (context.busy && active) stop();
      draw();
      if (pendingAuto && allowed()) { const record = pendingAuto; pendingAuto = null; void play(record); }
    };
    const clear = () => {
      stop(); automatic = false;
      for (const record of records) record.row.remove();
      records.clear();
      for (const key of cache.keys()) removeClip(key);
      draw();
    };
    toggle?.addEventListener("click", () => {
      if (!allowed()) return;
      automatic = !automatic;
      if (automatic) { if (!active) prime(); } else stop();
      draw();
    });
    host.addEventListener?.("pagehide", clear);
    doc.addEventListener?.("visibilitychange", () => { if (doc.hidden) stop(); else draw(); });
    draw();
    // 方案清单完全来自服务端白名单；页面只决定展示名称与顺序。
    let optionsBuilt = false;
    const applyProviders = (data) => {
      const list = Array.isArray(data?.providers) ? data.providers : [];
      providers = list
        .filter((item) => item && typeof item.id === "string" && item.language === "ja")
        .map((item) => ({ id: item.id, name: typeof item.name === "string" ? item.name : item.id, auto: item.auto === true, available: item.available === true }));
      // 兼容只回 enabled 的旧响应：按单方案处理。
      if (!providers.length) providers = [{ id: DEFAULT_PROVIDER, name: "Fish Audio", auto: true, available: data?.enabled === true && data.language === "ja" }];
      const usable = providers.filter((item) => item.available);
      provider = providers.some((item) => item.id === storedProvider && item.available) ? storedProvider : usable[0]?.id || providers[0].id;
      if (providerSelect && !optionsBuilt) {
        optionsBuilt = true;
        for (const item of providers) {
          const option = doc.createElement("option");
          option.value = item.id;
          option.textContent = item.available ? item.name : `${item.name}（不可用）`;
          option.disabled = !item.available;
          providerSelect.appendChild(option);
        }
      }
      if (providerSelect) providerSelect.value = provider;
    };
    providerSelect?.addEventListener("change", () => {
      const next = providers.some((item) => item.id === providerSelect.value && item.available) ? providerSelect.value : provider;
      if (next === provider) { draw(); return; }
      // 换方案等于换音色和音频容器，已缓存的音频不再适用。
      stop();
      for (const key of [...cache.keys()]) removeClip(key);
      provider = next;
      storedProvider = next;
      try { host.localStorage?.setItem(PROVIDER_STORAGE, next); } catch { /* 无法保存时仅本次有效 */ }
      draw();
    });
    if (audio && /^https?:$/.test(host.location?.protocol || "")) {
      const check = new host.AbortController();
      const timer = host.setTimeout(() => check.abort(), 5000);
      host.fetch("/api/tts", { cache: "no-store", signal: check.signal })
        .then((response) => response.ok ? response.json() : null)
        .then((data) => { applyProviders(data); })
        .catch(() => {})
        .finally(() => { checked = true; host.clearTimeout(timer); draw(); });
    } else { checked = true; draw(); }
    return { sync, addReply, stop, clear };
  }
  return { create };
});
