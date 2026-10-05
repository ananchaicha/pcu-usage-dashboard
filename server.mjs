import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = resolve(process.env.DATA_DIR || resolve(ROOT, "data"));
const DATASET_DIR = resolve(DATA_DIR, "datasets");
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "");
const SESSION_SECRET = String(process.env.SESSION_SECRET || "");
const SESSION_HOURS = Math.max(1, Number(process.env.SESSION_HOURS || 8));
const MAX_UPLOAD_BYTES = Math.max(1024, Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024));
const COOKIE_NAME = "pcu_admin_session";
const PERIOD_RE = /^(20\d{2})-(0[1-9]|1[0-2])$/;
const attempts = new Map();

if (!ADMIN_EMAIL.includes("@")) throw new Error("ADMIN_EMAIL is required");
if (ADMIN_PASSWORD.length < 12) throw new Error("ADMIN_PASSWORD must contain at least 12 characters");
if (SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");

await mkdir(DATASET_DIR, { recursive: true });
const dashboardPage = await readFile(resolve(ROOT, "site/index.html"), "utf8");

function securityHeaders(contentType = "application/json; charset=utf-8") {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...securityHeaders(), ...headers });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value));
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function sign(value) {
  return createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function createSession() {
  const payload = Buffer.from(JSON.stringify({ email: ADMIN_EMAIL, exp: Date.now() + SESSION_HOURS * 3600_000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function currentAdmin(req) {
  const token = parseCookies(req)[COOKIE_NAME] || "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return value.email === ADMIN_EMAIL && Number(value.exp) > Date.now() ? value : null;
  } catch {
    return null;
  }
}

async function readBody(req, limit) {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > limit) throw Object.assign(new Error("payload_too_large"), { status: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("payload_too_large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function clientKey(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function isRateLimited(req) {
  const key = clientKey(req);
  const now = Date.now();
  const state = attempts.get(key);
  if (!state || state.resetAt <= now) return false;
  return state.count >= 5;
}

function recordFailure(req) {
  const key = clientKey(req);
  const now = Date.now();
  const state = attempts.get(key);
  attempts.set(key, !state || state.resetAt <= now ? { count: 1, resetAt: now + 15 * 60_000 } : { ...state, count: state.count + 1 });
}

function clearFailures(req) {
  attempts.delete(clientKey(req));
}

function loginPage(message = "") {
  const notice = message ? `<div class="notice">${message}</div>` : "";
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>เข้าสู่ระบบผู้ดูแล</title><style>body{margin:0;background:#f2f7f5;color:#18313c;font:16px system-ui,Tahoma,sans-serif;display:grid;min-height:100vh;place-items:center}.card{width:min(430px,calc(100% - 32px));background:#fff;border:1px solid #dce8e3;border-radius:18px;padding:30px;box-sizing:border-box;box-shadow:0 14px 40px rgba(24,74,59,.1)}h1{font-size:24px;color:#14384a;margin:0 0 8px;text-align:center}p{color:#67808b;line-height:1.6;margin:0 0 20px;text-align:center}label{display:block;font-size:13px;color:#506b75;margin:13px 0 5px}input{width:100%;height:44px;border:1px solid #dce8e3;border-radius:10px;padding:0 11px;box-sizing:border-box;font:inherit}button{width:100%;border:0;background:#167a5b;color:#fff;border-radius:11px;padding:12px 16px;font:inherit;font-weight:600;margin-top:18px;cursor:pointer}.back{display:block;text-align:center;margin-top:18px;color:#167a5b;text-decoration:none;font-size:14px}.notice{background:#fdeaea;color:#a73c3c;border-radius:10px;padding:10px 12px;font-size:14px;margin-bottom:12px}</style></head><body><main class="card"><h1>เข้าสู่ระบบผู้ดูแล</h1><p>สำหรับอัปโหลดข้อมูลกลางและส่งออกผลกรอง</p>${notice}<form method="post" action="/admin/login"><label for="email">อีเมล</label><input id="email" name="email" type="email" autocomplete="username" required><label for="password">รหัสผ่าน</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">เข้าสู่ระบบ</button></form><a class="back" href="/">กลับไปหน้า Dashboard</a></main></body></html>`;
}

function loginHeaders(token) {
  const maxAge = Math.floor(SESSION_HOURS * 3600);
  return { "set-cookie": `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}` };
}

async function listDatasets() {
  const files = (await readdir(DATASET_DIR)).filter((name) => /^20\d{2}-(0[1-9]|1[0-2])\.csv$/.test(name));
  const entries = await Promise.all(files.map(async (name) => {
    const period = name.slice(0, -4);
    let metadata = {};
    try { metadata = JSON.parse(await readFile(resolve(DATASET_DIR, `${period}.json`), "utf8")); } catch {}
    const [year, month] = period.split("-").map(Number);
    return { period, month, year: year + 543, filenameEncoded: metadata.filenameEncoded || name, uploadedAt: metadata.uploadedAt || "" };
  }));
  return entries.sort((a, b) => b.period.localeCompare(a.period));
}

async function saveDataset(req, res) {
  if (!currentAdmin(req)) return sendJson(res, 403, { error: "บัญชีนี้ไม่มีสิทธิ์อัปโหลดข้อมูลกลาง" });
  const period = String(req.headers["x-dataset-period"] || "");
  if (!PERIOD_RE.test(period)) return sendJson(res, 400, { error: "ไม่พบเดือนและปีของข้อมูลในไฟล์ CSV" });
  const bytes = await readBody(req, MAX_UPLOAD_BYTES);
  if (!bytes.length) return sendJson(res, 400, { error: "ไฟล์ไม่มีข้อมูล" });
  const filenameEncoded = String(req.headers["x-dataset-filename"] || "shared-data.csv").slice(0, 500);
  const uploadedAt = new Date().toISOString();
  const csvPath = resolve(DATASET_DIR, `${period}.csv`);
  const tempPath = resolve(DATASET_DIR, `${period}.${process.pid}.tmp`);
  await writeFile(tempPath, bytes);
  await rename(tempPath, csvPath);
  await writeFile(resolve(DATASET_DIR, `${period}.json`), JSON.stringify({ filenameEncoded, uploadedAt, uploadedBy: ADMIN_EMAIL, period }, null, 2));
  console.log(JSON.stringify({ event: "dataset_uploaded", period, uploadedAt, uploadedBy: ADMIN_EMAIL, size: bytes.length }));
  return sendJson(res, 200, { ok: true, period, uploadedAt, size: bytes.length });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/healthz") return sendJson(res, 200, { ok: true });
  if (req.method === "GET" && url.pathname === "/") return send(res, 200, dashboardPage, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
  if (req.method === "GET" && url.pathname === "/api/me") return sendJson(res, 200, { isAdmin: Boolean(currentAdmin(req)), signedIn: Boolean(currentAdmin(req)) });
  if (req.method === "GET" && url.pathname === "/admin") {
    if (currentAdmin(req)) return send(res, 302, "", { location: "/?admin=1" });
    return send(res, 200, loginPage(), { "content-type": "text/html; charset=utf-8" });
  }
  if (req.method === "POST" && url.pathname === "/admin/login") {
    if (isRateLimited(req)) return send(res, 429, loginPage("เข้าสู่ระบบผิดหลายครั้ง กรุณารอ 15 นาที"), { "content-type": "text/html; charset=utf-8" });
    const form = new URLSearchParams((await readBody(req, 16 * 1024)).toString("utf8"));
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    if (!safeEqual(email, ADMIN_EMAIL) || !safeEqual(password, ADMIN_PASSWORD)) {
      recordFailure(req);
      return send(res, 401, loginPage("อีเมลหรือรหัสผ่านไม่ถูกต้อง"), { "content-type": "text/html; charset=utf-8" });
    }
    clearFailures(req);
    console.log(JSON.stringify({ event: "admin_login", email: ADMIN_EMAIL, at: new Date().toISOString() }));
    return send(res, 303, "", { location: "/?admin=1", ...loginHeaders(createSession()) });
  }
  if (["GET", "POST"].includes(req.method) && url.pathname === "/admin/logout") {
    return send(res, 303, "", { location: "/", "set-cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  }
  if (req.method === "GET" && url.pathname === "/api/datasets") {
    const periods = await listDatasets();
    return sendJson(res, 200, { periods, latest: periods[0]?.period || null });
  }
  if (req.method === "GET" && url.pathname === "/api/dataset") {
    const periods = await listDatasets();
    const period = PERIOD_RE.test(url.searchParams.get("period") || "") ? url.searchParams.get("period") : periods[0]?.period;
    if (!period) return sendJson(res, 404, { error: "ยังไม่มีข้อมูลกลาง" });
    const entry = periods.find((item) => item.period === period);
    if (!entry) return sendJson(res, 404, { error: "ไม่พบข้อมูลเดือนที่เลือก" });
    res.writeHead(200, { ...securityHeaders("text/csv; charset=utf-8"), "x-dataset-filename": entry.filenameEncoded, "x-dataset-uploaded-at": entry.uploadedAt, "x-dataset-period": period });
    return createReadStream(resolve(DATASET_DIR, `${period}.csv`)).pipe(res);
  }
  if (["PUT", "POST"].includes(req.method) && url.pathname === "/api/dataset") return saveDataset(req, res);
  return sendJson(res, 404, { error: "Not found" });
}

const server = createServer((req, res) => route(req, res).catch((error) => {
  const status = error.status || 500;
  console.error(JSON.stringify({ event: "request_error", status, message: error.message, path: req.url }));
  if (!res.headersSent) sendJson(res, status, { error: status === 413 ? "ไฟล์มีขนาดเกินกำหนด" : "เกิดข้อผิดพลาดภายในระบบ" });
  else res.destroy();
}));

server.listen(PORT, HOST, () => console.log(`PCU usage dashboard listening on ${HOST}:${PORT}`));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
