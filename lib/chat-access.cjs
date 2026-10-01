"use strict";

// 公开可下载的通用验证逻辑；盐、摘要和实例状态由服务端函数持有。
const { createHash, scryptSync, timingSafeEqual } = require("node:crypto");
const WINDOW_MS = 60_000;

function header(req, name) {
  const value = req.headers?.[name];
  return typeof value === "string" ? value : "";
}

function hasAccess(req, expected, salt, hash) {
  const encoded = header(req, "x-chat-access-code");
  if (!encoded || encoded.length > 1800) return false;
  let supplied;
  try { supplied = decodeURIComponent(encoded); } catch { return false; }
  if (!supplied || supplied.length > 200) return false;
  return expected
    ? timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(expected).digest())
    : timingSafeEqual(scryptSync(supplied, salt, 32), hash);
}

function clientKey(req) {
  // Vercel 覆盖 x-forwarded-for；本地测试优先使用真实 socket 地址。
  const ip = (process.env.VERCEL ? header(req, "x-forwarded-for").split(",")[0].trim() : req.socket?.remoteAddress) || "unknown";
  return createHash("sha256").update(ip).digest("hex");
}

function createAccessVerifier(salt, hash) {
  const accessFailures = new Map();
  let accessWindowStart = 0;
  let accessWindowCount = 0;
  return function verifyAccess(req, expected) {
    const now = Date.now();
    if (now - accessWindowStart >= WINDOW_MS) { accessWindowStart = now; accessWindowCount = 0; }
    for (const [key, entry] of accessFailures) if (now - entry.start >= WINDOW_MS) accessFailures.delete(key);
    const key = clientKey(req);
    const entry = accessFailures.get(key) || { start: now, count: 0 };
    // 仅热实例内生效，不代替持久防火墙限流。
    if (entry.count >= 5 || accessWindowCount >= 100) return 429;
    if (hasAccess(req, expected, salt, hash)) { accessFailures.delete(key); return 200; }
    entry.count += 1;
    accessWindowCount += 1;
    accessFailures.set(key, entry);
    return 401;
  };
}

module.exports = { clientKey, createAccessVerifier };
