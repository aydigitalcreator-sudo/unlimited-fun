// Vercel serverless function: /api/image
// Uses your existing GEMINI_API_KEY first. Optional free backup: CF_ACCOUNT_ID + CF_API_TOKEN (Cloudflare Workers AI).

import { guard } from "./_lib.js";
import { makeImage } from "./_img.js";

const BAD = /\b(nude|naked|porn|sex|nsfw|gore|rape|child abuse)\b/i;

export default async function handler(req, res) {
  const E = process.env;
  const g = await guard(req, res, "image");
  if (!g) return;

  const { prompt, w, h } = req.body || {};
  const p = String(prompt || "").slice(0, 700).trim();
  if (!p) return res.status(400).json({ error: "Empty prompt" });
  if (BAD.test(p)) return res.status(400).json({ error: "Please keep it family-friendly" });
  const img = await makeImage(p, w, h);
  if (!img) return res.status(502).json({ error: "Image AI unavailable" });
  return res.status(200).json({ image: img });
}
