// Vercel serverless function: /api/chat
// Add ONE of these in Vercel > Settings > Environment Variables (the key stays on the server):
//   GEMINI_API_KEY    (free tier at aistudio.google.com, no card needed)  <- tried first
//   OPENAI_API_KEY    (ChatGPT's API, paid credit)                         <- tried second
//   ANTHROPIC_API_KEY (Claude API, paid credit)                            <- tried third
// Optional model overrides: GEMINI_MODEL (optional), OPENAI_MODEL, ANTHROPIC_MODEL

const BASE = "You are the chat buddy inside the UNLIMITED FUN app. Think about what the person actually asked. First give a real, correct, useful answer, like a smart friend would. Then add humor that is specific to THEIR question: a clever twist, exaggeration or observation. Never use generic filler jokes that could fit any question. Pay attention to how the person feels. If they sound sad, stressed, lonely or upset, drop the jokes, be warm and caring, and give gentle, practical advice. If they ask for advice, give clear, honest, useful suggestions. If something is serious (health, safety, abuse, self-harm), be kind and encourage them to talk to someone they trust or a professional. Answer as fully and deeply as the question deserves: simple questions get short answers, bigger questions get thorough, well-organised answers with examples. Stay conversational. Use everyday Nigerian references when natural.";
const SYSTEM = {
  witty: BASE + " Style: quick-witted and warm.",
  sarcastic: BASE + " Style: dry, playful sarcasm, never cruel.",
  playful: BASE + " Style: bubbly, silly and encouraging.",
  pidgin: BASE + " Write the whole reply in fun Nigerian Pidgin English.",
  task: "You write short, original, fun content for the UNLIMITED FUN entertainment app. Follow the instruction exactly and output ONLY the requested content: no preface, no surrounding quotes, no explanations. Keep it under 120 words unless told otherwise. Light humor, kind tone, everyday Nigerian flavour when natural.",
  json: "Output ONLY valid JSON in exactly the requested shape. No markdown, no code fences, no commentary. Keep the content fun, harmless and family-friendly."
};
import { guard } from "./_lib.js";

const RULES = " Never help with threats, harassment, hate, sexual content involving minors, or anything dangerous or illegal; decline lightly and change the subject. Never write scam, phishing, fake giveaway, fake job or loan, impersonation or money-doubling messages, and never ask the user for passwords, PINs, OTP codes or bank details. If the user attaches a photo or document, read it carefully and answer from it. If you used web search, name the useful apps or websites; never invent links, because the app shows search buttons itself. This app also has an AI Image Maker and a Video Maker on other pages. If the user wants a picture, logo, poster or video made, warmly tell them to tap the button under your reply to open it, and never say you cannot; do not pretend to create the picture or video in the chat.";

export default async function handler(req, res) {
  const g = await guard(req, res, "chat");
  if (!g) return;

  const { messages, mode, spicy, memory, friend, remember, attachments, web } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "No messages" });

  let msgs = messages.slice(-12).map(m => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, 14000)
  })).filter(m => m.content);
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length) return res.status(400).json({ error: "No user message" });

  const mem = String(memory || "").slice(0, 900);
  const fr = String(friend || "Fun").replace(/[^\p{L}\p{N} ]/gu, "").slice(0, 20) || "Fun";
  const friendTxt = remember
    ? ` You are ${fr}, the user's long-term AI friend. Talk warmly like a real friend who knows them.` +
      (mem ? ` Things you already know about them: ${mem}. Use these naturally when relevant; never list them back or say you have a memory.` : "") +
      ` If the user shares a NEW lasting fact about themselves (name, job, school, city, goal, family, hobbies, birthday, a long-term situation), end your reply with a final line like [[MEM: short fact]] (max 2 tags). Never record passwords, ID or bank numbers, health or medical details, or anything sexual. If nothing new, add no tag.`
    : "";
  const system = (SYSTEM[mode] || SYSTEM.witty) + friendTxt + (spicy ? " Spicy mode is on: be cheekier, but still never abusive." : "") + RULES;
  const E = process.env;
  const post = (url, headers, body, tmo = 10000) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(tmo) });
  const OKMIME = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/;
  const atts = (Array.isArray(attachments) ? attachments : []).slice(0, 3)
    .filter(a => a && OKMIME.test(String(a.mime)) && typeof a.data === "string" && a.data.length < 4200000 && /^[A-Za-z0-9+/=]+$/.test(a.data.slice(0, 200)))
    .map(a => ({ mime: String(a.mime), data: a.data }));
  let sources = [];
  const t0 = Date.now();

  try {
    let reply = "";
    if (E.GEMINI_API_KEY) {
      const models = [E.GEMINI_MODEL, "gemini-3.8-flash", "gemini-flash-latest", "gemini-flash-lite-latest"].filter(Boolean);
      const useWeb = !!web, big = atts.length > 0 || useWeb;
      const tmo = big ? 28000 : 10000, deadline = big ? 50000 : 35000;
      const contents = msgs.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
      if (atts.length) {
        const lu = contents.map(c => c.role).lastIndexOf("user");
        contents[lu].parts = [...atts.map(a => ({ inlineData: { mimeType: a.mime, data: a.data } })), ...contents[lu].parts];
      }
      const body = { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: 2048 } };
      if (useWeb) body.tools = [{ google_search: {} }];
      let last = "";
      for (const model of models) {
        if (Date.now() - t0 > deadline) break;
        let r, d;
        for (let i = 0; i < 3; i++) {
          try {
            r = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${E.GEMINI_API_KEY}`, {}, body, tmo);
            d = await r.json();
          } catch (e) { r = { ok: false, status: 0 }; d = { error: { message: "timeout" } }; }
          if (r.status === 503) { await new Promise(x => setTimeout(x, 600)); continue; }        // "high demand": try again
          if (!r.ok && body.tools && [400, 403, 429].includes(r.status)) { delete body.tools; continue; }   // web search not allowed: answer without it
          break;
        }
        if (r.ok) {
          const cand = d.candidates?.[0];
          reply = (cand?.content?.parts || []).map(p => p.text || "").join("");
          const seen = new Set();
          sources = (cand?.groundingMetadata?.groundingChunks || []).map(c => c.web)
            .filter(w => w && /^https:\/\//.test(w.uri || ""))
            .filter(w => { const k = w.title || w.uri; if (seen.has(k)) return false; seen.add(k); return true; })
            .slice(0, 4).map(w => ({ t: String(w.title || w.uri).slice(0, 80), u: w.uri }));
          break;
        }
        last = "Gemini " + r.status + " (" + model + "): " + String((d.error && d.error.message) || "").slice(0, 160);
        if (![0, 404, 429, 500, 503].includes(r.status)) break;   // try the next model for these errors
      }
      if (!reply) throw new Error(last || "Gemini returned no text");
    } else if (E.OPENAI_API_KEY) {
      const r = await post("https://api.openai.com/v1/chat/completions", { authorization: "Bearer " + E.OPENAI_API_KEY }, {
        model: E.OPENAI_MODEL || "gpt-4o-mini",
        max_completion_tokens: 1500,
        messages: [{ role: "system", content: system }, ...msgs]
      });
      const d = await r.json();
      if (!r.ok) throw new Error("OpenAI " + r.status + ": " + String((d.error && d.error.message) || "").slice(0, 200));
      reply = d.choices?.[0]?.message?.content || "";
    } else if (E.ANTHROPIC_API_KEY) {
      const r = await post("https://api.anthropic.com/v1/messages", { "x-api-key": E.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, {
        model: E.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: 1500, system, messages: msgs
      });
      const d = await r.json();
      if (!r.ok) throw new Error("Anthropic " + r.status + ": " + String((d.error && d.error.message) || "").slice(0, 200));
      reply = (d.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    } else {
      return res.status(500).json({ error: "No API key set on the server" });
    }
    if (!reply) throw new Error("empty");
    return res.status(200).json({ reply, sources });
  } catch (e) {
    return res.status(502).json({ error: "AI unavailable" });
  }
}
