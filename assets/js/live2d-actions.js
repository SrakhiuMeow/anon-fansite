/* 将对话语义映射到每套模型实际提供的动作；不修改原模型参数。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AnonLive2DActions = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const defaults = Object.freeze({
    neutral: { motion: "idle01", expression: "default" },
    smile: { motion: "smile01", expression: "smile01" },
    wink: { motion: "wink01", expression: "wink01" },
    shy: { motion: "shame01", expression: "shame01" },
    surprised: { motion: "surprised01", expression: "surprised01" },
    thinking: { motion: "thinking01", expression: "thinking01" },
    serious: { motion: "serious01", expression: "serious01" },
    sad: { motion: "sad01", expression: "sad01" },
    angry: { motion: "angry01", expression: "angry01" },
    wave: { motion: "bye01", expression: "smile01" },
    cheer: { motion: "kandou01", expression: "smile01" },
    cry: { motion: "cry01", expression: "cry01" },
    pose: { motion: "kime01", expression: "smile01" },
  });
  const stem = (name) => String(name).replace(/\.(?:mtn|motion3\.json)$/, "");
  const motionIndex = (costume, name) => costume?.motions?.findIndex((item) => stem(item) === name) ?? -1;
  const semantic = (request) => {
    if (Object.hasOwn(defaults, request.emotion)) return request.emotion;
    return Object.keys(defaults).find((key) => request.motion
      ? defaults[key].motion === request.motion
      : request.expression && defaults[key].expression === request.expression);
  };
  function resolve(costume, request = {}) {
    const emotion = semantic(request);
    const mapped = emotion && (costume.reactions?.[emotion] || (!costume.reactions && defaults[emotion]));
    let motion = request.motion;
    let expression = request.expression;
    if (mapped) {
      // 手动表情按钮只切表情；动作按钮同时采用配套表情，避免上一情绪残留。
      motion = request.emotion || request.motion ? mapped.motion : undefined;
      expression = mapped.expression;
    }
    if ((!motion && !expression) || (motion && motionIndex(costume, motion) < 0) || (expression && !costume.expressions.includes(expression))) return null;
    return { emotion, motion, expression, index: motion ? motionIndex(costume, motion) : -1, group: costume.motionGroup || "reaction" };
  }
  return { defaults, stem, motionIndex, resolve };
});
