// LGS paneli: statik dosyalar + kayıt API'si (SQLite, ek sunucu yok)
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const PORT = +(process.env.PORT || 80);
const DB_PATH = process.env.DB_PATH || "/data/lgs.db";
const TOKEN = process.env.APP_TOKEN || "";
const PUB = join(import.meta.dirname, "public");
const KEEP = +(process.env.HISTORY_KEEP || 300);

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
CREATE TABLE IF NOT EXISTS state(id TEXT PRIMARY KEY, json TEXT NOT NULL, v INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS history(n INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, v INTEGER NOT NULL, json TEXT NOT NULL, saved INTEGER NOT NULL);`);
const qGet = db.prepare("SELECT json, v, updated FROM state WHERE id=?");
const qPut = db.prepare("INSERT INTO state(id,json,v,updated) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json, v=excluded.v, updated=excluded.updated");
const qHist = db.prepare("INSERT INTO history(id,v,json,saved) VALUES(?,?,?,?)");
const qPrune = db.prepare("DELETE FROM history WHERE id=? AND n NOT IN (SELECT n FROM history WHERE id=? ORDER BY n DESC LIMIT ?)");
const qHList = db.prepare("SELECT v, saved, length(json) AS size FROM history WHERE id=? ORDER BY n DESC LIMIT 50");
const qHOne = db.prepare("SELECT json, v, saved FROM history WHERE id=? AND v=? ORDER BY n DESC LIMIT 1");
const ID = "main";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png", ".ics": "text/calendar", ".json": "application/json" };

const send = (res, code, body, headers = {}) => {
  const b = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(b);
};
const authed = (req) => {
  if (!TOKEN) return false;
  const h = req.headers.authorization || "";
  const got = Buffer.from(h.startsWith("Bearer ") ? h.slice(7) : "");
  const want = Buffer.from(TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
};
const readBody = (req, limit = 2 * 1024 * 1024) => new Promise((ok, bad) => {
  let n = 0; const parts = [];
  req.on("data", (c) => { n += c.length; if (n > limit) { bad(Object.assign(new Error("too large"), { code: 413 })); req.destroy(); } else parts.push(c); });
  req.on("end", () => ok(Buffer.concat(parts).toString("utf8")));
  req.on("error", bad);
});

async function api(req, res, url) {
  if (url.pathname === "/api/health") return send(res, 200, { ok: true, token: !!TOKEN });
  if (!TOKEN) return send(res, 503, { error: "APP_TOKEN ayarlı değil" });
  if (!authed(req)) return send(res, 401, { error: "Kod hatalı" });

  if (url.pathname === "/api/state") {
    if (req.method === "GET") {
      const r = qGet.get(ID);
      return r ? send(res, 200, r) : send(res, 404, { error: "Henüz kayıt yok", v: 0 });
    }
    if (req.method === "PUT") {
      let body; try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.code === 413 ? 413 : 400, { error: "Geçersiz veri" }); }
      if (typeof body.json !== "string") return send(res, 400, { error: "json alanı eksik" });
      try { JSON.parse(body.json); } catch { return send(res, 400, { error: "json bozuk" }); }
      const cur = qGet.get(ID), curV = cur ? cur.v : 0;
      if (!body.force && (+body.base || 0) !== curV) return send(res, 409, cur || { v: 0 });
      if (cur && cur.json === body.json) return send(res, 200, { v: curV, updated: cur.updated });
      const v = curV + 1, now = Date.now();
      db.exec("BEGIN");
      try { qPut.run(ID, body.json, v, now); qHist.run(ID, v, body.json, now); qPrune.run(ID, ID, KEEP); db.exec("COMMIT"); }
      catch (e) { db.exec("ROLLBACK"); throw e; }
      return send(res, 200, { v, updated: now });
    }
    return send(res, 405, { error: "Yöntem desteklenmiyor" });
  }
  if (url.pathname === "/api/history" && req.method === "GET") {
    const v = url.searchParams.get("v");
    if (v) { const r = qHOne.get(ID, +v); return r ? send(res, 200, r) : send(res, 404, { error: "Yok" }); }
    return send(res, 200, qHList.all(ID));
  }
  return send(res, 404, { error: "Bulunamadı" });
}

async function file(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith("/")) p += "index.html";
  const full = normalize(join(PUB, p));
  if (!full.startsWith(PUB)) return send(res, 403, "Yasak", { "content-type": "text/plain" });
  let target = full;
  try { if (!(await stat(target)).isFile()) throw 0; } catch { target = join(PUB, "index.html"); }
  const ext = extname(target);
  const cache = target.includes("/icons/") ? "public, max-age=604800" : "no-cache";
  const buf = await readFile(target);
  res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": cache, "x-content-type-options": "nosniff" });
  res.end(req.method === "HEAD" ? undefined : buf);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try { url.pathname.startsWith("/api/") ? await api(req, res, url) : await file(req, res, url); }
  catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: "Sunucu hatası" }); else res.end(); }
}).listen(PORT, () => console.log(`LGS paneli :${PORT} · db ${DB_PATH} · token ${TOKEN ? "var" : "YOK"}`));

for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => { try { db.close(); } catch {} process.exit(0); });
