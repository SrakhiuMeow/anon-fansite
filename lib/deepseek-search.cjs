"use strict";

// DeepSeek 的原生联网工具走 Anthropic Messages；不从模型正文猜测搜索或拼接来源。
const ENDPOINT = "https://api.deepseek.com/anthropic/v1/messages";
const MAX_SOURCES = 6;
const MAX_SEARCHES = 2;

function sourceOf(item) {
  if (!item || typeof item.url !== "string" || item.url.length > 2048 || /[\u0000-\u0020\u007f]/u.test(item.url)) return null;
  try {
    const url = new URL(item.url);
    if (!["https:", "http:"].includes(url.protocol) || url.href.length > 2048 || url.username || url.password) return null;
    return { url: url.href, title: typeof item.title === "string" && item.title.trim() ? item.title.trim().slice(0, 160) : url.hostname };
  } catch { return null; }
}

function requestBody(model, system, messages) {
  return {
    model, system, messages, stream: true, max_tokens: 800,
    thinking: { type: "disabled" }, temperature: 0.8,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES }],
  };
}

function makeSearchParser(emitter, send) {
  const blocks = new Map();
  const results = new Map();
  const citations = new Map();
  let started = false;
  let finished = false;
  let complete = false;
  let searchCount = 0;
  let searchFailed = false;
  let gotResults = false;
  const addSource = (target, item) => {
    const source = sourceOf(item);
    if (source && target.size < 30 && !target.has(source.url)) target.set(source.url, source);
  };
  const readCitations = (items) => {
    if (items == null) return;
    if (!Array.isArray(items) || items.length > 100) throw new Error("search-citations");
    for (const item of items) if (item?.type === "web_search_result_location") addSource(citations, item);
  };
  const readResults = (content) => {
    if (!Array.isArray(content)) {
      if (content?.type !== "web_search_tool_result_error") throw new Error("search-results");
      searchFailed = true;
      send({ type: "search", status: "unavailable" });
      return;
    }
    if (content.length > 100) throw new Error("search-results");
    gotResults = true;
    for (const item of content) if (item?.type === "web_search_result") addSource(results, item);
    send({ type: "search", status: "completed" });
  };
  return {
    push(chunk) {
      if (!chunk || typeof chunk.type !== "string" || complete) throw new Error("search-event");
      if (chunk.type === "ping") return;
      if (chunk.type === "error") throw new Error("search-upstream");
      if (chunk.type === "message_start") {
        if (started || chunk.message?.role !== "assistant") throw new Error("search-start");
        started = true;
        return;
      }
      if (!started || finished && !["message_delta", "message_stop"].includes(chunk.type)) throw new Error("search-order");
      if (chunk.type === "content_block_start") {
        const block = chunk.content_block;
        if (!Number.isInteger(chunk.index) || blocks.has(chunk.index) || blocks.size >= 32 || !block) throw new Error("search-block");
        blocks.set(chunk.index, block.type);
        if (block.type === "text") {
          if (typeof block.text !== "string") throw new Error("search-text");
          emitter.push(block.text);
          readCitations(block.citations);
        } else if (block.type === "server_tool_use" && block.name === "web_search") {
          // max_uses 由服务端执行；超限尝试可跟随工具错误和解释正文，不在此提前截断。
          if (++searchCount > 8) throw new Error("search-limit");
          send({ type: "search", status: "searching" });
        } else if (block.type === "web_search_tool_result") readResults(block.content);
        else if (!["thinking", "redacted_thinking"].includes(block.type)) throw new Error("search-tool");
      } else if (chunk.type === "content_block_delta") {
        const kind = blocks.get(chunk.index);
        const delta = chunk.delta;
        if (!kind || !delta) throw new Error("search-delta");
        if (kind === "text" && delta.type === "text_delta" && typeof delta.text === "string") emitter.push(delta.text);
        else if (kind === "text" && delta.type === "citations_delta") readCitations([delta.citation]);
        else if (kind === "server_tool_use" && delta.type === "input_json_delta" && typeof delta.partial_json === "string") { /* 搜索词交由上游执行，不回传或记录。 */ }
        else if (kind === "thinking" && ["thinking_delta", "signature_delta"].includes(delta.type)) { /* 不公开推理内容。 */ }
        else throw new Error("search-delta");
      } else if (chunk.type === "content_block_stop") {
        if (!blocks.delete(chunk.index)) throw new Error("search-block-stop");
      } else if (chunk.type === "message_delta") {
        if (chunk.delta?.stop_reason != null) {
          if (chunk.delta.stop_reason !== "end_turn" || blocks.size) throw new Error("search-finish");
          finished = true;
        }
      } else if (chunk.type === "message_stop") {
        if (!finished || blocks.size) throw new Error("search-incomplete");
        complete = true;
      } else throw new Error("search-event");
    },
    finish() {
      if (!complete || !finished) throw new Error("search-incomplete");
      if (searchCount && !gotResults && !searchFailed) throw new Error("search-missing-results");
      const sources = [...new Map([...citations, ...results]).values()].slice(0, MAX_SOURCES);
      if (gotResults && sources.length) send({ type: "sources", sources });
    },
    get complete() { return complete; },
  };
}

module.exports = { ENDPOINT, requestBody, makeSearchParser };
