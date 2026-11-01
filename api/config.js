// Public settings the app reads on start (no secrets, no prices paid by sponsors).
import { getConfig, publicConfig } from "./_lib.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
  const c = await getConfig();
  return res.status(200).json(publicConfig(c));
}
