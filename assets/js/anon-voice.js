/* 爱音合成语音：只朗读完整 AI 回复，音频和开关仅保留在当前页面。 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AnonVoice = api;
})(typeof window !== "undefined" ? window : null, function (root) {
  "use strict";
  const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
  const MAX_CACHE_BYTES = 12 * 1024 * 1024;
  // 一小段静音用于在点击事件内激活播放器；浏览器仍拒绝时保留手动播放入口。
  const SILENCE = "data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA";

  function create(options = {}) {
    const host = options.host || root;
    if (!host?.document) return null;
    const doc = host.document;
    const toggle = doc.getElementById("anonVoiceAuto");
    const status = doc.getElementById("anonVoiceStatus");
    const getAccessCode = options.getAccessCode || (() => "");
    const records = new Set();
    const cache = new Map();
    let cacheBytes = 0;
    let context = { ai: false, unlocked: false, busy: false };
    let available = false;
    let checked = false;
    let automatic = false;
    let pendingAuto = null;
    let version = 0;
    let active = null;
    let controller = null;
    let audio;
    let detachAudio = () => {};
    try { audio = new host.Audio(); audio.preload = "auto"; } catch { /* 无音频能力仍可聊天。 */ }

    const allowed = () => available && !!audio && context.ai && context.unlocked && !context.busy && !doc.hidden;
    const connected = (record) => record.element.isConnected !== false;
    const draw = () => {
      if (toggle) {
        toggle.hidden = !context.ai;
        toggle.disabled = !allowed();
        toggle.textContent = `自动朗读：${automatic ? "开" : "关"}`;
        toggle.setAttribute("aria-checked", String(automatic));
      }
      if (status) {
        status.hidden = !context.ai;
        status.textContent = !audio ? "此浏览器暂不支持语音播放。" : !checked ? "正在检查语音服务…"
          : !available ? "爱音语音服务待配置，文字聊天仍可使用。"
          : "千早爱音 · AI合成音色。播放时仅将这条回复发送给 Fish Audio，自动朗读默认关闭。";
      }
      for (const record of records) {
        const current = active?.record === record;
        record.button.disabled = !current && !allowed();
        record.button.textContent = current ? "停止语音" : cache.has(record.text) ? "重播语音" : "播放语音";
        record.button.setAttribute("aria-label", current ? "停止本条语音" : "以爱音合成音色朗读本条回复");
        record.button.setAttribute("aria-pressed", String(current));
      }
    };
    const removeClip = (text) => {
      const clip = cache.get(text);
      if (!clip) return;
      host.URL.revokeObjectURL(clip.url);
      cacheBytes -= clip.size;
      cache.delete(text);
    };
    const prune = () => {
      for (const record of records) if (!connected(record)) {
        if (active?.record === record) stop();
        if (pendingAuto === record) pendingAuto = null;
        records.delete(record);
      }
      for (const text of cache.keys()) if (![...records].some((record) => record.text === text)) removeClip(text);
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
    const keepClip = (text, blob) => {
      const clip = { url: host.URL.createObjectURL(blob), size: blob.size };
      removeClip(text);
      cache.set(text, clip); cacheBytes += blob.size;
      for (const key of cache.keys()) {
        if (cache.size <= 5 && cacheBytes <= MAX_CACHE_BYTES) break;
        if (key !== text) removeClip(key);
      }
      return clip;
    };
    const readAudio = async (response, signal) => {
      if (Number(response.headers.get("content-length")) > MAX_AUDIO_BYTES) throw new Error("语音文件过大，请重试。");
      if (!/^audio\/(?:mpeg|mp3)(?:;|$)/i.test(response.headers.get("content-type") || "")) throw new Error("语音返回格式异常，请重试。");
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
        return new host.Blob(pieces, { type: "audio/mpeg" });
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    };
    const play = async (record, gesture = false) => {
      if (active?.record === record) { stop(); return; }
      if (!allowed() || !connected(record)) return;
      stop(); prune();
      const current = version;
      const task = new host.AbortController();
      controller = task;
      active = { record };
      if (gesture) prime();
      record.state.textContent = cache.has(record.text) ? "准备播放…" : "正在生成语音…";
      draw();
      const timeout = host.setTimeout(() => task.abort("timeout"), 70000);
      const requireCurrent = () => {
        if (current !== version || task.signal.aborted || !connected(record) || !allowed()) throw new Error("cancelled");
      };
      try {
        let clip = cache.get(record.text);
        if (!clip) {
          const response = await host.fetch("/api/tts", {
            method: "POST", signal: task.signal,
            headers: { "Content-Type": "application/json", "X-Chat-Access-Code": encodeURIComponent(getAccessCode()) },
            body: JSON.stringify({ text: record.text }),
          });
          requireCurrent();
          if (!response.ok) {
            // 仅识别本站固定错误码，供应商正文和任意服务端文案不进入 DOM。
            let code = "";
            if (response.status === 503 && /^application\/json(?:;|$)/i.test(response.headers.get("content-type") || "")) {
              try { code = (await response.json())?.code; } catch {}
              requireCurrent();
            }
            await response.body?.cancel().catch(() => {});
            if (response.status === 401) throw new Error("请重新解锁 AI 聊天后播放。");
            if (response.status === 429) throw new Error("语音请求较多，请稍后再试。");
            if (code === "VOICE_AUTH_FAILED") throw new Error("语音服务密钥不可用，请站长检查配置。");
            if (code === "VOICE_ACCESS_DENIED") throw new Error("语音模型或音色访问受限，请站长检查权限。");
            if (code === "VOICE_CREDIT_REQUIRED") throw new Error("语音服务暂不满足免费调用条件，请站长检查账号状态。");
            if (code === "VOICE_NOT_FOUND") throw new Error("语音音色暂不可用，请站长检查音色配置。");
            if (response.status === 503) throw new Error("语音服务暂不可用，请稍后再试。");
            throw new Error("语音生成失败，请重试。");
          }
          const blob = await readAudio(response, task.signal);
          requireCurrent();
          clip = keepClip(record.text, blob);
        }
        requireCurrent();
        host.clearTimeout(timeout);
        audio.src = clip.url;
        const finish = (failed = false) => {
          if (current !== version || active?.record !== record) return;
          record.state.textContent = failed ? "播放失败，可重试。" : "播放完毕";
          if (failed) removeClip(record.text);
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
        record.state.textContent = "正在播放 · AI合成";
      } catch (error) {
        if (current !== version) return;
        record.state.textContent = error?.name === "NotAllowedError" ? "语音已就绪，请点击重播。"
          : task.signal.reason === "timeout" ? "语音生成超时，请重试。"
          : task.signal.aborted ? "已停止"
          : error.message === "cancelled" ? "已停止" : /^语音|^请重新|^没有收到/.test(error.message) ? error.message : "语音播放失败，请重试。";
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
    if (audio && /^https?:$/.test(host.location?.protocol || "")) {
      const check = new host.AbortController();
      const timer = host.setTimeout(() => check.abort(), 5000);
      host.fetch("/api/tts", { cache: "no-store", signal: check.signal })
        .then((response) => response.ok ? response.json() : null)
        .then((data) => { available = data?.enabled === true; })
        .catch(() => {})
        .finally(() => { checked = true; host.clearTimeout(timer); draw(); });
    } else { checked = true; draw(); }
    return { sync, addReply, stop, clear };
  }
  return { create };
});
