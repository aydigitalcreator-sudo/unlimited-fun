// Vercel serverless function: /api/voice
// Turns one line of text into speech using Cloudflare Workers AI (needs CF_ACCOUNT_ID and CF_API_TOKEN).

import { guard } from "./_lib.js";

export default async function handler(req, res) {
  const E = process.env;
  const g = await guard(req, res, "voice");
  if (!g) return;

  const text = String((req.body && req.body.text) || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: "Empty text" });
  if (!E.CF_ACCOUNT_ID || !E.CF_API_TOKEN) return res.status(502).json({ error: "Voice unavailable" });

  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${E.CF_ACCOUNT_ID}/ai/run/@cf/myshell-ai/melotts`, {
      method: "POST",
      headers: { Authorization: "Bearer " + E.CF_API_TOKEN, "content-type": "application/json" },
      body: JSON.stringify({ prompt: text, lang: "en" }),
      signal: AbortSignal.timeout(25000)
    });
    const type = r.headers.get("content-type") || "";
    let b64 = "";
    if (type.includes("application/json")) {
      const d = await r.json();
      const a = d && d.result && (d.result.audio || d.result);
      b64 = typeof a === "string" ? a : "";
    } else if (r.ok) {
      b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
    }
    if (!b64) return res.status(502).json({ error: "Voice unavailable" });
    return res.status(200).json({ audio: b64.startsWith("data:") ? b64 : "data:audio/mpeg;base64," + b64 });
  } catch (e) {
    return res.status(502).json({ error: "Voice unavailable" });
  }
}
