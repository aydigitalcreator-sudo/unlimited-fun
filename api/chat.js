// Vercel serverless function: /api/chat
// Add ONE of these in Vercel > Settings > Environment Variables (the key stays on the server):
//   GEMINI_API_KEY    (free tier at aistudio.google.com, no card needed)  <- tried first
//   OPENAI_API_KEY    (ChatGPT's API, paid credit)                         <- tried second
//   ANTHROPIC_API_KEY (Claude API, paid credit)                            <- tried third
// Optional model overrides: GEMINI_MODEL, OPENAI_MODEL, ANTHROPIC_MODEL

const BASE = "You are the chat buddy inside the UNLIMITED FUN app. Think about what the person actually asked. First give a real, correct, useful answer, like a smart friend would. Then add humor that is specific to THEIR question: a clever twist, exaggeration or observation. Never use generic filler jokes that could fit any question. Pay attention to how the person feels. If they sound sad, stressed, lonely or upset, drop the jokes, be warm and caring, and give gentle, practical advice. If they ask for advice, give clear, honest, useful suggestions. If something is serious (health, safety, abuse, self-harm), be kind and encourage them to talk to someone they trust or a professional. Answer as fully and deeply as the question deserves: simple questions get short answers, bigger questions get thorough, well-organised answers with examples. Stay conversational. Use everyday Nigerian references when natural.";
const SYSTEM = {
  witty: BASE + " Style: quick-witted and warm.",
  sarcastic: BASE + " Style: dry, playful sarcasm, never cruel.",
  playful: BASE + " Style: bubbly, silly and encouraging.",
  pidgin: BASE + " Write the whole reply in fun Nigerian Pidgin English.",
  task: "You write short, original, fun content for the UNLIMITED FUN entertainment app. Follow the instruction exactly and output ONLY the requested content: no preface, no surrounding quotes, no explanations. Keep it under 120 words unless told otherwise. Light humor, kind tone, everyday Nigerian flavour when natural.",
  json: "Output ONLY valid JSON in exactly the requested shape. No markdown, no code fences, no commentary. Keep the content fun, harmless and family-friendly."
};
const RULES = " Never help with threats, harassment, hate, sexual content involving minors, or anything dangerous or illegal; decline lightly and change the subject.";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { messages, mode, spicy } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "No messages" });

  let msgs = messages.slice(-12).map(m => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, 1500)
  })).filter(m => m.content);
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length) return res.status(400).json({ error: "No user message" });

  const system = (SYSTEM[mode] || SYSTEM.witty) + (spicy ? " Spicy mode is on: be cheekier, but still never abusive." : "") + RULES;
  const E = process.env;
  const post = (url, headers, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  try {
    let reply = "";
    if (E.GEMINI_API_KEY) {
      const model = E.GEMINI_MODEL || "gemini-2.5-flash";
      const r = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${E.GEMINI_API_KEY}`, {}, {
        systemInstruction: { parts: [{ text: system }] },
        contents: msgs.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: 2048 }
      });
      const d = await r.json();
      if (!r.ok) throw new Error("Gemini " + r.status + ": " + String((d.error && d.error.message) || "").slice(0, 200));
      reply = (d.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
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
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(502).json({ error: "AI unavailable", detail: String(e.message || e).slice(0, 250) });
  }
          }
