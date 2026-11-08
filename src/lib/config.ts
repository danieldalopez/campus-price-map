// app_config: the numbers the app and Databricks share (docs/SPEC.md section 6). Server only.

import { query } from "./db";
import { DEFAULT_CONFIG, type WalkConfig } from "./walkworth";


const NUMBER_KEYS = [
  "bc_min_wage",
  "weeks_term",
  "weeks_year",
  "weeks_degree",
  "even_band",
  "worth_max_extra_min",
] as const;

export async function loadConfig(): Promise<WalkConfig> {
  const rows = await query<{ key: string; value: string }>("reader", "select key, value from app_config");
  const raw = new Map(rows.map((r) => [r.key, r.value.trim()]));
  const config: WalkConfig = { ...DEFAULT_CONFIG };
  for (const key of NUMBER_KEYS) {
    const n = Number(raw.get(key));
    if (raw.has(key) && Number.isFinite(n) && n >= 0) config[key] = n;
  }
  const rt = raw.get("round_trip")?.toLowerCase();
  if (rt === "true" || rt === "false") config.round_trip = rt === "true";
  return config;
}
