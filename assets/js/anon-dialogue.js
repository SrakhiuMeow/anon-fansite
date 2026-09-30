/* 原创同人规则对话：仅在本页内匹配，不调用 AI，不发送或保存聊天内容。 */
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
  let request = 0;
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
  };
  const submit = async (raw) => {
    const result = api.reply(raw);
    if (!result) { input.focus(); return; }
    const version = ++request;
    append("user", api.normalize(raw));
    append("anon", result.text);
    input.value = "";
    // 手机将画面带回模型与最新回复，收起软键盘；两个面板不会互相遮挡。
    if (root.matchMedia?.("(max-width: 700px)").matches) {
      input.blur();
      const controls = root.document.querySelector(".l2d-controls");
      if (controls) controls.scrollTop = 0;
      root.document.getElementById("anonRoom")?.scrollIntoView({ block: "start", behavior: "instant" });
      await new Promise((resolve) => root.requestAnimationFrame(() => root.requestAnimationFrame(resolve)));
    }
    if (state) state.textContent = "正在尝试播放对应动作…";
    try {
      const outcome = await root.AnonLive2D?.react(result);
      if (version !== request) return;
      if (state) state.textContent = outcome?.ok ? `已响应：${result.label}。对话为本站原创同人内容。` : outcome?.reason || "文字回复已送达；模型暂未就绪。";
    } catch {
      if (version === request && state) state.textContent = "文字回复已送达；模型暂不可用，可点重试。";
    }
  };
  form.addEventListener("submit", (event) => { event.preventDefault(); void submit(input.value); });
  append("anon", "欢迎来到我的应援小房间！试着打个招呼，或对我说「眨眼」吧。");
  root.document.querySelectorAll("[data-chat-prompt]").forEach((button) => button.addEventListener("click", () => { void submit(button.dataset.chatPrompt); }));
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
  return { normalize, reply };
});
