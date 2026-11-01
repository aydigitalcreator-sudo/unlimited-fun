// Shared helpers for the API (this file is not a public route because it starts with "_").
import crypto from "node:crypto";

export const DEFAULTS = {
  announcement: "",
  maintenance: false,
  features: { chat: true, image: true, video: true, voice: true },
  limits: { chat: 60, image: 10, voice: 30 },
  slots: { home: "", explore: "", favs: "", result: "", games: "", gate: "" },
  adGate: { enabled: false, seconds: 8 },
  plans: [{ name: "Weekly", days: 7, price: 0, credits: 3, maxSeconds: 10 }, { name: "Monthly", days: 30, price: 0, credits: 12, maxSeconds: 15 }, { name: "Yearly", days: 365, price: 0, credits: 150, maxSeconds: 15 }],
  video: { enabled: false, trialPerDay: 1, trialSeconds: 5, dailyPool: 5, creditSeconds: 5, costPerSecond: 0.05, freeBudget: 1.25, usdRate: 1500, feePct: 2, monthlyCap: 100 },
  subMultiplier: 3,
  contactWhatsApp: "",
  sponsors: [],
  dailyMessage: "",
  topup: {
    enabled: false,
    currency: "\u20a6",
    note: "Credits are non-transferable and non-refundable.",
    packs: [
      { credits: 500, bonus: 50, price: 0 }, { credits: 1000, bonus: 100, price: 0 }, { credits: 3000, bonus: 400, price: 0 },
      { credits: 10000, bonus: 1500, price: 0 }, { credits: 20000, bonus: 3000, price: 0 }, { credits: 30000, bonus: 5000, price: 0 }
    ]
  }
};
const VERS = { chat: "v7", image: "img2", voice: "voice2" };
const LABEL = { chat: "messages", image: "pictures", voice: "voice lines" };

const RURL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const RTOK = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const hasStore = () => !!(RURL() && RTOK());

export async function redis(...cmd) {
  const r = await fetch(RURL(), { method: "POST", headers: { Authorization: "Bearer " + RTOK() }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(4000) });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.result;
}
export async function pipe(cmds) {
  const r = await fetch(RURL() + "/pipeline", { method: "POST", headers: { Authorization: "Bearer " + RTOK() }, body: JSON.stringify(cmds), signal: AbortSignal.timeout(4000) });
  const d = await r.json();
  if (!Array.isArray(d)) throw new Error("pipeline");
  return d.map(x => x.result);
}

const mem = globalThis.__ufmem || (globalThis.__ufmem = { c: new Map(), burst: new Map(), cfg: null, cfgAt: 0 });
const memInc = k => { if (mem.c.size > 20000) mem.c.clear(); const v = (mem.c.get(k) || 0) + 1; mem.c.set(k, v); return v; };
export const day = (back = 0) => new Date(Date.now() - back * 864e5).toISOString().slice(0, 10).replace(/-/g, "");

const numc = (v, max) => { v = Number(v); return Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 100) / 100 : 0; };
function cleanSponsor(s) {
  s = s && typeof s === "object" ? s : {};
  const date = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
  const link = String(s.link || "").trim();
  return {
    id: String(s.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 12) || crypto.randomBytes(5).toString("hex"),
    name: String(s.name || "").slice(0, 40), text: String(s.text || "").slice(0, 140),
    link: /^https:\/\//i.test(link) ? link.slice(0, 300) : "",
    place: ["home", "download", "chat"].filter(p => Array.isArray(s.place) && s.place.includes(p)),
    start: date(s.start), end: date(s.end), amount: numc(s.amount, 1e9), active: s.active !== false
  };
}
export function publicConfig(c) {
  const today = new Date().toISOString().slice(0, 10);
  const sp = (c.sponsors || []).filter(x => x.active && x.name && x.text && x.place.length && (!x.start || x.start <= today) && (!x.end || x.end >= today)).map(x => ({ id: x.id, name: x.name, text: x.text, link: x.link, place: x.place }));
  const { sponsors, subMultiplier, ...rest } = c;
  return { ...rest, video: { enabled: c.video.enabled, trialSeconds: c.video.trialSeconds, creditSeconds: c.video.creditSeconds }, sponsors: sp, subX: subMultiplier };
}
export function sanitize(i) {
  i = i && typeof i === "object" ? i : {};
  const D = DEFAULTS, f = i.features || {}, l = i.limits || {}, s = i.slots || {};
  const n = (v, d) => { v = parseInt(v, 10); return Number.isFinite(v) && v >= 0 && v <= 5000 ? v : d; };
  const b = (v, d) => (typeof v === "boolean" ? v : d);
  return {
    announcement: String(i.announcement || "").slice(0, 300),
    maintenance: b(i.maintenance, false),
    features: { chat: b(f.chat, true), image: b(f.image, true), video: b(f.video, true), voice: b(f.voice, true) },
    limits: { chat: n(l.chat, D.limits.chat), image: n(l.image, D.limits.image), voice: n(l.voice, D.limits.voice) },
    slots: Object.fromEntries(Object.keys(D.slots).map(k => [k, String(s[k] || "").replace(/[^0-9]/g, "").slice(0, 20)])),
    dailyMessage: String(i.dailyMessage || "").slice(0, 400),
    plans: (Array.isArray(i.plans) ? i.plans : D.plans).slice(0, 5).map(p => ({ name: String((p && p.name) || "").slice(0, 20) || "Plan", days: Math.min(3650, Math.max(1, parseInt(p && p.days, 10) || 7)), price: numc(p && p.price, 1e9), credits: Math.min(100000, Math.max(0, parseInt(p && p.credits, 10) || 0)), maxSeconds: [5, 10, 15].includes(parseInt(p && p.maxSeconds, 10)) ? parseInt(p.maxSeconds, 10) : 10 })),
    video: (() => { const v = i.video && typeof i.video === "object" ? i.video : {}, I = (x, lo, hi, d) => { x = parseInt(x, 10); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; }; return { enabled: b(v.enabled, false), trialPerDay: I(v.trialPerDay, 0, 20, 1), trialSeconds: I(v.trialSeconds, 5, 15, 5), dailyPool: I(v.dailyPool, 0, 100000, 5), creditSeconds: I(v.creditSeconds, 5, 15, 5), costPerSecond: Math.min(5, Math.max(0.001, Number(v.costPerSecond) || 0.05)), freeBudget: Math.min(1000, Math.max(0, Number(v.freeBudget == null ? 1.25 : v.freeBudget) || 0)), usdRate: Math.min(100000, Math.max(1, Number(v.usdRate) || 1500)), monthlyCap: I(v.monthlyCap, 0, 100000, 100), feePct: Math.min(20, Math.max(0, Number(v.feePct == null ? 2 : v.feePct) || 0)) }; })(),
    subMultiplier: Math.min(20, Math.max(1, n(i.subMultiplier, 3))),
    contactWhatsApp: String(i.contactWhatsApp || "").replace(/[^0-9]/g, "").slice(0, 15),
    sponsors: (Array.isArray(i.sponsors) ? i.sponsors : []).slice(0, 20).map(cleanSponsor),
    adGate: { enabled: b(i.adGate && i.adGate.enabled, false), seconds: Math.min(20, Math.max(3, n(i.adGate && i.adGate.seconds, 8))) },
    topup: (() => {
      const t = i.topup && typeof i.topup === "object" ? i.topup : {};
      const num = (v, max) => { v = Number(v); return Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 100) / 100 : 0; };
      const src = Array.isArray(t.packs) ? t.packs : D.topup.packs;
      return {
        enabled: b(t.enabled, false),
        currency: String(t.currency == null ? D.topup.currency : t.currency).slice(0, 4),
        note: String(t.note == null ? D.topup.note : t.note).slice(0, 300),
        packs: src.slice(0, 6).map(p => ({ credits: Math.round(num(p && p.credits, 1e7)), bonus: Math.round(num(p && p.bonus, 1e7)), price: num(p && p.price, 1e8) }))
      };
    })()
  };
}
// Settings come from the defaults above, plus an optional UF_CONFIG setting in Vercel (JSON), for example {"video":{"enabled":true}}.
export async function getConfig() {
  if (mem.cfg) return mem.cfg;
  let o = {};
  try { o = process.env.UF_CONFIG ? JSON.parse(process.env.UF_CONFIG) : {}; } catch (e) { o = {}; }
  mem.cfg = sanitize(o);
  return mem.cfg;
}

export function originOk(req, res) {
  const ORIGINS = (process.env.ALLOWED_ORIGINS || "https://unlimited-fun-d9vg.vercel.app").split(",").map(x => x.trim());
  const origin = req.headers.origin || "";
  const ok = !origin || ORIGINS.includes(origin) || /^https:\/\/unlimited-fun[a-z0-9-]*\.vercel\.app$/.test(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  if (!ok) { res.status(403).json({ error: "Not allowed" }); return false; }
  res.setHeader("Access-Control-Allow-Origin", origin || ORIGINS[0]);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-uf-device, authorization");
  return true;
}

// Checks origin, method, maintenance, feature switch and daily limits. Returns null when it already answered.
export async function guard(req, res, kind) {
  if (!originOk(req, res)) return null;
  if (req.method === "OPTIONS") { res.status(204).end(); return null; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only", version: VERS[kind] }); return null; }

  const ip = String(req.headers["x-forwarded-for"] || "x").split(",")[0].trim();
  const now = Date.now();
  const burst = (mem.burst.get(ip) || []).filter(t => now - t < 600000);
  if (burst.length >= 80) { res.status(429).json({ error: "USER:Too many requests. Please wait a few minutes." }); return null; }
  burst.push(now); mem.burst.set(ip, burst); if (mem.burst.size > 5000) mem.burst.clear();

  const cfg = await getConfig();
  if (cfg.maintenance) { res.status(503).json({ error: "USER:We are making updates. Please come back soon." }); return null; }
  if (cfg.features[kind] === false) { res.status(503).json({ error: "USER:This feature is switched off for now." }); return null; }

  const code = normCode(req.headers["x-uf-code"]);
  let isSub = false;
  if (code) { try { isSub = subActive(await subCached(code), String(req.headers["x-uf-device"] || "").replace(/[^a-z0-9]/gi, "").slice(0, 40)); } catch (e) { isSub = false; } }
  const limit = cfg.limits[kind] * (isSub ? Math.max(1, cfg.subMultiplier || 1) : 1);
  const dev = String(req.headers["x-uf-device"] || "").replace(/[^a-z0-9]/gi, "").slice(0, 40) || "nodev";
  const d = day();
  const kD = `uf:c:${d}:${kind}:d:${dev}`, kI = `uf:c:${d}:${kind}:i:${ip}`, kT = `uf:t:${d}:${kind}`;
  let cd, ci;
  if (hasStore()) {
    try {
      const cmds = [["INCR", kD], ["EXPIRE", kD, 172800], ["INCR", kI], ["EXPIRE", kI, 172800], ["INCR", kT], ["EXPIRE", kT, 1000000], ["INCR", `uf:tot:${kind}`]];
      if (kind === "chat") cmds.push(["PFADD", `uf:u:${d}`, dev], ["EXPIRE", `uf:u:${d}`, 1000000]);
      const r = await pipe(cmds);
      cd = r[0]; ci = r[2];
    } catch (e) { cd = memInc(kD); ci = memInc(kI); }
  } else { cd = memInc(kD); ci = memInc(kI); }
  if (cd > limit || ci > limit * 4) {
    res.status(429).json({ error: `USER:Daily limit reached (${limit} ${LABEL[kind]}). Come back tomorrow.` });
    return null;
  }
  return { cfg, left: Math.max(0, limit - cd), isSub };
}

// ---------- subscribers (a person types a code to activate a plan) ----------
const SUBS = "uf:subs";
const memSubs = mem.subs || (mem.subs = new Map());
const subCache = mem.subCache || (mem.subCache = new Map());
const A32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newCode() { const b = crypto.randomBytes(8); let s = ""; for (const x of b) s += A32[x % 32]; return "UF-" + s.slice(0, 4) + "-" + s.slice(4); }
export function normCode(c) {
  const s = String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const t = s.startsWith("UF") ? s.slice(2) : s;
  return t.length === 8 ? "UF-" + t.slice(0, 4) + "-" + t.slice(4) : "";
}
export async function subGet(code) {
  if (!code) return null;
  if (!hasStore()) return memSubs.get(code) || null;
  try { const v = await redis("HGET", SUBS, code); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
export async function subPut(rec) { subCache.delete(rec.code); if (!hasStore()) { memSubs.set(rec.code, rec); return; } await redis("HSET", SUBS, rec.code, JSON.stringify(rec)); }
export async function subDel(code) { subCache.delete(code); if (!hasStore()) { memSubs.delete(code); return; } await redis("HDEL", SUBS, code); }
export async function subAll() {
  if (!hasStore()) return [...memSubs.values()];
  const a = (await redis("HGETALL", SUBS)) || [], out = [];
  for (let i = 1; i < a.length; i += 2) { try { out.push(JSON.parse(a[i])); } catch (e) { /* skip */ } }
  return out;
}
async function subCached(code) {
  const c = subCache.get(code);
  if (c && Date.now() - c.at < 60000) return c.r;
  const r = await subGet(code);
  subCache.set(code, { r, at: Date.now() }); if (subCache.size > 2000) subCache.clear();
  return r;
}
export const subActive = (r, dev) => !!(r && r.end && Date.parse(r.end) > Date.now() && (!dev || (r.devices || []).includes(dev)));

// ---------- small limiter for light endpoints ----------
export async function light(req, res, kind, max, perIp) {
  if (!originOk(req, res)) return null;
  if (req.method === "OPTIONS") { res.status(204).end(); return null; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return null; }
  const ip = String(req.headers["x-forwarded-for"] || "x").split(",")[0].trim();
  const dev = String(req.headers["x-uf-device"] || "").replace(/[^a-z0-9]/gi, "").slice(0, 40);
  const k = `uf:l:${day()}:${kind}:${perIp ? ip : (dev || ip)}`;
  let c;
  if (hasStore()) { try { c = (await pipe([["INCR", k], ["EXPIRE", k, 172800]]))[0]; } catch (e) { c = memInc(k); } } else c = memInc(k);
  if (c > max) { res.status(429).json({ error: "Too many tries. Please wait." }); return null; }
  return { dev, ip };
}

// ---------- counters used by the video rules ----------
export async function bump(key, ttl, by) {
  const up = by >= 0;
  if (hasStore()) { try { return (await pipe([[up ? "INCR" : "DECR", key], ["EXPIRE", key, ttl]]))[0]; } catch (e) { /* use memory */ } }
  const v = (mem.c.get(key) || 0) + (up ? 1 : -1); mem.c.set(key, v); return v;
}
export async function peek(key) {
  if (hasStore()) { try { return Math.max(0, +(await redis("GET", key)) || 0); } catch (e) { /* use memory */ } }
  return Math.max(0, mem.c.get(key) || 0);
}

// How many free videos everyone together can make today: your daily money budget divided by the cost of one trial video.
export const freePool = V => (V.freeBudget > 0 ? Math.floor(V.freeBudget / (V.trialSeconds * V.costPerSecond)) : V.dailyPool);

// ---------- small key/value helpers (jobs and the last video error) ----------
export async function kvSet(key, val, ttl) {
  if (hasStore()) { try { await redis("SET", key, val, "EX", ttl); return; } catch (e) { /* use memory */ } }
  (mem.kv || (mem.kv = new Map())).set(key, val);
}
export async function kvGet(key) {
  if (hasStore()) { try { return await redis("GET", key); } catch (e) { /* use memory */ } }
  return (mem.kv && mem.kv.get(key)) || null;
}
