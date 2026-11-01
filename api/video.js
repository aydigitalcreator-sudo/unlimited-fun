// Real AI video with Runway (https://docs.dev.runwayml.com).
// Needs the secret RUNWAYML_API_SECRET in Vercel. Optional settings: RUNWAY_MODEL, RUNWAY_MODE ("image" or "text"), RUNWAY_VERSION.
import { makeImage } from "./_img.js";

const BASE = () => process.env.RUNWAY_BASE || "https://api.dev.runwayml.com";
const headers = () => ({ Authorization: "Bearer " + process.env.RUNWAYML_API_SECRET, "X-Runway-Version": process.env.RUNWAY_VERSION || "2024-11-06", "content-type": "application/json" });
const RATIOS = { tall: "720:1280", wide: "1280:720", square: "960:960" };

export const MAX_SECONDS = 10;
export const ready = () => !!process.env.RUNWAYML_API_SECRET;

async function call(path, opts) {
  const r = await fetch(BASE() + path, { ...opts, headers: headers(), signal: AbortSignal.timeout(30000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Runway ${r.status}: ${String(d.error || d.message || JSON.stringify(d)).slice(0, 220)}`);
  return d;
}

// Starts a video and returns { task }. The video itself takes a minute or two, so the app asks again with check().
export async function generate({ prompt, seconds, ratio, image }) {
  const duration = seconds <= 5 ? 5 : 10, rt = RATIOS[ratio] || RATIOS.tall;
  let path, body;
  if ((process.env.RUNWAY_MODE || "image") === "text") {
    path = "/v1/text_to_video";
    body = { model: process.env.RUNWAY_MODEL || "veo3.1_fast", promptText: prompt, ratio: rt, duration };
  } else {
    const first = image || (await makeImage(prompt, rt === "1280:720" ? 1280 : 768, rt === "1280:720" ? 720 : 1344));
    if (!first) throw new Error("No first picture could be made for the video.");
    path = "/v1/image_to_video";
    body = { model: process.env.RUNWAY_MODEL || "gen4_turbo", promptImage: first, promptText: prompt, ratio: rt, duration };
  }
  const d = await call(path, { method: "POST", body: JSON.stringify(body) });
  if (!d.id) throw new Error("Runway did not return a task id.");
  return { task: d.id };
}

export async function check(task) {
  const d = await call("/v1/tasks/" + encodeURIComponent(task), { method: "GET" });
  const s = String(d.status || "").toUpperCase();
  if (s === "SUCCEEDED") return { state: "done", url: (d.output || [])[0] || "" };
  if (s === "FAILED" || s === "CANCELLED") return { state: "failed", error: String(d.failure || d.failureCode || s).slice(0, 200) };
  return { state: "running", progress: typeof d.progress === "number" ? d.progress : null };
}
