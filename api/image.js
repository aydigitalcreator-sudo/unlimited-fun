// Vercel serverless function: /api/image
// Uses your existing GEMINI_API_KEY first. Optional free backup: CF_ACCOUNT_ID + CF_API_TOKEN (Cloudflare Workers AI).

const BAD = /\b(nude|naked|porn|sex|nsfw|gore|rape|child abuse)\b/i;

async function geminiModels(key) {
  if (globalThis.__imgModels && globalThis.__imgModels.length) return globalThis.__imgModels;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${key}`, { signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  const L = (d.models || [])
    .filter(m => /image/i.test(m.name) && !/imagen/i.test(m.name) && (m.supportedGenerationMethods || []).includes("generateContent"))
    .map(m => m.name.replace("models/", ""))
    .sort((a, b) => (/flash/.test(b) ? 1 : 0) - (/flash/.test(a) ? 1 : 0) || b.localeCompare(a));
  if (L.length) globalThis.__imgModels = L;
  return L;
}

async function viaGemini(key, prompt) {
  const models = (await geminiModels(key)).slice(0, 2);
  let last = "no image model";
  for (const m of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE", "TEXT"] } }),
        signal: AbortSignal.timeout(28000)
      });
      const d = await r.json();
      const part = ((d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || []).find(p => p.inlineData && p.inlineData.data);
      if (part) return `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`;
      last = (d.error && d.error.message) || "no image returned";
    } catch (e) { last = String(e.message || e); }
  }
  throw new Error(last);
}

async function viaCloudflare(id, token, prompt) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${id}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ prompt, steps: 6 }),
    signal: AbortSignal.timeout(30000)
  });
  const d = await r.json();
  const b = d && d.result && d.result.image;
  if (!b) throw new Error("no image");
  return "data:image/jpeg;base64," + b;
}

export default async function handler(req, res) {
  const E = process.env;
  const ORIGINS = (E.ALLOWED_ORIGINS || "https://unlimited-fun-d9vg.vercel.app").split(",").map(x => x.trim());
  const origin = req.headers.origin || "";
  const ok = !origin || ORIGINS.includes(origin) || /^https:\/\/unlimited-fun[a-z0-9-]*\.vercel\.app$/.test(origin);
  if (!ok) return res.status(403).json({ error: "Not allowed" });
  res.setHeader("Access-Control-Allow-Origin", origin || ORIGINS[0]);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only", version: "img1" });

  const hits = globalThis.__imgHits || (globalThis.__imgHits = new Map());
  const ip = String(req.headers["x-forwarded-for"] || "x").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 600000);
  if (recent.length >= 15) return res.status(429).json({ error: "Too many pictures. Please wait a few minutes." });
  recent.push(now); hits.set(ip, recent); if (hits.size > 5000) hits.clear();

  const { prompt, w, h } = req.body || {};
  const p = String(prompt || "").slice(0, 700).trim();
  if (!p) return res.status(400).json({ error: "Empty prompt" });
  if (BAD.test(p)) return res.status(400).json({ error: "Please keep it family-friendly" });
  const shape = +w > +h ? "wide landscape picture" : +h > +w ? "tall portrait picture" : "square picture";
  const full = `Create a ${shape}: ${p}. No text, no watermark, no logo.`;

  let img = null;
  if (E.GEMINI_API_KEY) { try { img = await viaGemini(E.GEMINI_API_KEY, full); } catch (e) { /* try next */ } }
  if (!img && E.CF_ACCOUNT_ID && E.CF_API_TOKEN) { try { img = await viaCloudflare(E.CF_ACCOUNT_ID, E.CF_API_TOKEN, p); } catch (e) { /* none left */ } }
  if (!img) return res.status(502).json({ error: "Image AI unavailable" });
  return res.status(200).json({ image: img });
}
