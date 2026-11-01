// A subscriber types the code they were given. The code works on up to 2 devices.
import { light, normCode, subGet, subPut } from "./_lib.js";

export default async function handler(req, res) {
  const b0 = req.body || {};
  const g = await light(req, res, b0.check ? "rcheck" : "redeem", b0.check ? 200 : 10, !b0.check);
  if (!g) return;
  const code = normCode(b0.code);
  if (!code) return res.status(400).json({ error: "That code does not look right." });
  if (g.dev.length < 8) return res.status(400).json({ error: "Please try again." });
  const rec = await subGet(code);
  if (!rec) return res.status(404).json({ error: "Code not found." });
  rec.devices = Array.isArray(rec.devices) ? rec.devices : [];
  if (!rec.end) {
    // first use: the plan starts today and runs for its full length
    if (b0.check) return res.status(403).json({ error: "Not active on this device." });
    if (rec.claimBy && Date.parse(rec.claimBy) < Date.now()) return res.status(410).json({ error: "This code expired before it was used. Contact us." });
    const now = Date.now();
    rec.start = new Date(now).toISOString();
    rec.end = new Date(now + (rec.days || 7) * 864e5).toISOString();
  } else if (Date.parse(rec.end) <= Date.now()) return res.status(410).json({ error: "This plan has ended." });
  if (!rec.devices.includes(g.dev)) {
    if (b0.check) return res.status(403).json({ error: "Not active on this device." });
    if (rec.devices.length >= 2) return res.status(403).json({ error: "This code is already used on 2 devices. Contact us." });
    rec.devices.push(g.dev);
    await subPut(rec);
  }
  return res.status(200).json({ ok: true, plan: rec.planName, end: rec.end, name: rec.name });
}
