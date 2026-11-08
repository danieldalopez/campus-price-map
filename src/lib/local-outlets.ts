// Server only (reads the filesystem). Step 1 stand-in: Home reads
// data/outlets.csv straight from the repo. Step 4 replaces this with /api/locations.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Outlet } from "./outlet";
import { PLACEHOLDER_OUTLETS } from "./outlets-fixture";

export type OutletLoad = {
  outlets: Outlet[];
  /** "csv" = data/outlets.csv; "placeholder" = the Step 1 fixture. */
  source: "csv" | "placeholder";
  /** Why the placeholder was used, for the on-screen note and the build log. */
  reason: string | null;
};

const CSV_PATH = path.join(process.cwd(), "data", "outlets.csv");

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** "Hours Weekday" → "hours_weekday", "Lat" → "lat". */
function normHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

const ALIASES: Record<string, string> = {
  latitude: "lat",
  longitude: "lng",
  lon: "lng",
  long: "lng",
  location_id: "id",
  outlet_id: "id",
  benchmark: "is_benchmark",
};

function text(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

function truthy(v: string | undefined): boolean {
  return /^(true|t|yes|y|1)$/i.test((v ?? "").trim());
}

export function outletsFromCsv(csv: string): Outlet[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normHeader).map((h) => ALIASES[h] ?? h);
  const col = (name: string) => headers.indexOf(name);
  const get = (r: string[], name: string) => {
    const i = col(name);
    return i === -1 ? undefined : r[i];
  };

  const outlets: Outlet[] = [];
  for (const r of rows.slice(1)) {
    const id = text(get(r, "id"));
    const name = text(get(r, "name"));
    const lat = Number.parseFloat(get(r, "lat") ?? "");
    const lng = Number.parseFloat(get(r, "lng") ?? "");
    // SPEC section 6: skip any row without coordinates.
    if (!id || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const type = text(get(r, "type"));
    outlets.push({
      id,
      name,
      area: text(get(r, "area")),
      operator: text(get(r, "operator")),
      type,
      address: text(get(r, "address")),
      hoursWeekday: text(get(r, "hours_weekday")),
      hoursWeekend: text(get(r, "hours_weekend")),
      lat,
      lng,
      isBenchmark: col("is_benchmark") !== -1 ? truthy(get(r, "is_benchmark")) : type === "grocery",
    });
  }
  return outlets;
}

export function loadOutlets(): OutletLoad {
  let csv: string;
  try {
    csv = readFileSync(CSV_PATH, "utf8");
  } catch {
    return placeholder("data/outlets.csv is not in the repo yet");
  }
  const outlets = outletsFromCsv(csv);
  if (outlets.length === 0) {
    return placeholder("data/outlets.csv has no rows with coordinates yet");
  }
  return { outlets, source: "csv", reason: null };
}

function placeholder(reason: string): OutletLoad {
  console.warn(`[outlets] ${reason}; using the 5-outlet placeholder fixture.`);
  return { outlets: PLACEHOLDER_OUTLETS, source: "placeholder", reason };
}
