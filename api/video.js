// Rules for real AI video:
//  - free users: a short trial (default 1 a day, 5 seconds), with a shared daily pool for everyone
//  - subscribers: video credits from their plan; extra credit packs add more
import { originOk, getConfig, subGet, subPut, subActive, normCode, day, bump, peek, freePool, kvGet, kvSet } from "./_lib.js";
import { ready, generate, check, MAX_SECONDS } from "./_video.js";

const BAD = /\b(nude|naked|porn|sex|nsfw|gore|rape|child abuse)\b/i;
const month = () => new Date().toISOString().slice(0, 7).replace("-", "");
const logErr = e => { console.error("video error:", String((e && e.message) || e).slice(0, 300)); return kvSet("uf:verr", JSON.stringify({ t: Date.now(), msg: String((e && e.message) || e).slice(0, 300) }), 604800); };
// Gives back what a failed video used: the credit (subscriber) or the free trial.
async function refundJob(job) {
  if (job.kind === "sub" && job.code) { const rec = await subGet(job.code); if (rec) { rec.credits = (rec.credits || 0) + job.cost; await subPut(rec); } }
  else if (job.keys) { await bump(job.keys.t, 172800, -1); await bump(job.keys.i, 172800, -1); await bump(job.keys.p, 172800, -1); }
  for (const k of job.mk || []) await bump(k, 3000000, -1);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!originOk(req, res)) return;
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only", version: "video1" });

  const b = req.body || {};
  const dev = String(req.headers["x-uf-device"] || "").replace(/[^a-z0-9]/gi, "").slice(0, 40);
  if (dev.length < 8) return res.status(400).json({ error: "USER:Please try again." });
  const ip = String(req.headers["x-forwarded-for"] || "x").split(",")[0].trim();
  const cfg = await getConfig(), V = cfg.video;
  if (cfg.maintenance) return res.status(503).json({ error: "USER:We are making updates. Please come back soon." });

  const code = normCode(req.headers["x-uf-code"]);
  const rec = code ? await subGet(code) : null;
  const isSub = subActive(rec, dev);
  const d = day(), tKey = `uf:vt:${d}:d:${dev}`, iKey = `uf:vt:${d}:i:${ip}`, pKey = `uf:vt:${d}:all`, TTL = 172800;
  const POOL = freePool(V);
  const used = await peek(tKey), pool = await peek(pKey);
  const planMax = Math.min(MAX_SECONDS, (cfg.plans.find(p => p.name === (rec && rec.planName)) || {}).maxSeconds || 10);
  const now = new Date();
  const status = {
    enabled: V.enabled, mode: isSub ? "sub" : "free", plan: isSub ? rec.planName : null,
    trialSeconds: V.trialSeconds, trialLeft: Math.max(0, V.trialPerDay - used), poolLeft: Math.max(0, POOL - pool),
    credits: isSub ? Math.max(0, rec.credits || 0) : 0, maxSeconds: isSub ? planMax : V.trialSeconds, creditSeconds: V.creditSeconds, talkCredits: V.talkCredits, talkAllowed: isSub,
    resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString()
  };
  if (b.action === "poll") {
    const id = String(b.id || "").replace(/[^a-zA-Z0-9-]/g, "");
    let job = null;
    try { job = JSON.parse((await kvGet("uf:vj:" + id)) || "null"); } catch (e) { job = null; }
    if (!job || job.dev !== dev) return res.status(404).json({ error: "USER:Video not found. Please try again." });
    if (job.done) return res.status(200).json(job.failed ? { status: "failed", error: "USER:The video could not be made. You were not charged." } : { status: "done", url: job.url });
    let st;
    try { st = await check(job.id); } catch (e) { await logErr(e); return res.status(200).json({ status: "running", progress: null }); }
    if (st.state === "running") return res.status(200).json({ status: "running", progress: st.progress });
    job.done = true;
    if (st.state === "done" && st.url) { job.url = st.url; await kvSet("uf:vj:" + id, JSON.stringify(job), 86400); return res.status(200).json({ status: "done", url: st.url }); }
    job.failed = true; await refundJob(job); await logErr(st.error || "The video failed.");
    await kvSet("uf:vj:" + id, JSON.stringify(job), 86400);
    return res.status(200).json({ status: "failed", error: "USER:The video could not be made. You were not charged." });
  }
  if (b.action !== "start") return res.status(200).json(status);

  const talk = b.talk === true;
  const sec = talk ? ([4, 6, 8].includes(parseInt(b.seconds, 10)) ? parseInt(b.seconds, 10) : 8) : Math.min(15, Math.max(5, parseInt(b.seconds, 10) || 5));
  const image = typeof b.image === "string" && b.image.length < 4200000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(b.image) ? b.image : null;
  if (!V.enabled || !ready()) return res.status(503).json({ error: "USER:Real AI video is not switched on yet. It is coming soon." });
  let prompt;
  if (talk) {
    const say = String(b.say || "").replace(/["\u201c\u201d]/g, "'").replace(/\s+/g, " ").trim().slice(0, 200), who = String(b.who || "").replace(/["\u201c\u201d]/g, "'").trim().slice(0, 100);
    if (say.length < 3) return res.status(400).json({ error: "USER:Write what the person should say." });
    if (BAD.test(say + " " + who)) return res.status(400).json({ error: "USER:Please keep it family-friendly." });
    if (!isSub) return res.status(403).json({ error: "USER:Talking videos are for subscribers. Subscribe to unlock them." });
    prompt = image
      ? `The person in the picture looks at the camera and says clearly: "${say}". Natural lip movement, natural voice and small head movements.`
      : `${who || "A friendly person"} looks at the camera and says clearly: "${say}". Realistic, natural lip movement and voice, steady camera, soft lighting.`;
  } else {
    prompt = String(b.prompt || "").trim().slice(0, 500);
    if (prompt.length < 3) return res.status(400).json({ error: "USER:Describe the video first." });
    if (BAD.test(prompt)) return res.status(400).json({ error: "USER:Please keep it family-friendly." });
  }
  const M = month(), mAll = `uf:vc:${M}:all`;
  if (V.monthlyCap > 0 && (await peek(mAll)) >= V.monthlyCap) return res.status(503).json({ error: "USER:Real AI video is paused for this month. Please try next month." });

  let refund, costNow = 0;
  if (isSub) {
    if (!talk && sec > planMax) return res.status(400).json({ error: `USER:Your plan allows videos up to ${planMax} seconds.` });
    const cost = talk ? V.talkCredits : Math.ceil(sec / V.creditSeconds);
    costNow = cost;
    if ((rec.credits || 0) < cost) return res.status(402).json({ error: "USER:No video credits left. Buy a credit pack, or wait for your plan to renew." });
    rec.credits -= cost; await subPut(rec);
    refund = async () => { const again = (await subGet(rec.code)) || rec; again.credits = (again.credits || 0) + cost; await subPut(again); };
  } else {
    if (sec > V.trialSeconds) return res.status(403).json({ error: `USER:Free videos are ${V.trialSeconds} seconds. Subscribe for longer videos.` });
    if (used >= V.trialPerDay) return res.status(403).json({ error: "USER:Your free video for today is used. Subscribe, or come back tomorrow." });
    const undo = async (n) => { if (n >= 1) await bump(tKey, TTL, -1); if (n >= 2) await bump(iKey, TTL, -1); if (n >= 3) await bump(pKey, TTL, -1); };
    if ((await bump(tKey, TTL, 1)) > V.trialPerDay) { await undo(1); return res.status(403).json({ error: "USER:Your free video for today is used. Subscribe, or come back tomorrow." }); }
    if ((await bump(iKey, TTL, 1)) > Math.max(1, V.trialPerDay) * 3) { await undo(2); return res.status(403).json({ error: "USER:Too many free videos from this network today. Subscribe, or come back tomorrow." }); }
    if ((await bump(pKey, TTL, 1)) > POOL) { await undo(3); return res.status(403).json({ error: "USER:Free videos are finished for today. Subscribe, or come back tomorrow." }); }
    refund = () => undo(3);
  }
  try {
    const out = await generate({ prompt, seconds: sec, ratio: String(b.ratio || "tall"), image, talk });
    const kind = isSub ? "sub" : "free", mk = [mAll, `uf:vc:${M}:${kind}`];
    for (const k of mk) await bump(k, 3000000, 1);
    const job = { id: out.task, dev, kind, code: isSub ? rec.code : null, cost: isSub ? costNow : 0, keys: isSub ? null : { t: tKey, i: iKey, p: pKey }, mk, done: false };
    await kvSet("uf:vj:" + out.task, JSON.stringify(job), 86400);
    return res.status(200).json({ ok: true, id: out.task });
  } catch (e) {
    await refund(); await logErr(e);
    return res.status(502).json({ error: "USER:The video could not be made. You were not charged." });
  }
}
