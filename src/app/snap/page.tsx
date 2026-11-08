import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import SnapFlow, { SnapShell } from "@/components/SnapFlow";
import { DbConfigError } from "@/lib/db";
import { loadSnapItems, loadSnapOutlets } from "@/lib/snap-data";

export const metadata: Metadata = { title: "Snap a price · Campus Price Map" };

/**
 * Snap a price (SPEC section 7): camera, Gemini reads it, the student confirms, the report saves as pending.
 * The item and outlet lists come from Lakebase at request time, so they're read inside Suspense.
 */
export default function SnapPage() {
  return (
    <Suspense fallback={<SnapShell />}>
      <SnapLoader />
    </Suspense>
  );
}

async function SnapLoader() {
  await connection();
  const lists = await Promise.all([loadSnapItems(), loadSnapOutlets()]).catch((err: unknown) => {
    const kind = err instanceof DbConfigError ? err.message : err instanceof Error ? err.name : "unknown";
    console.error(`[snap] loading items and outlets failed: ${kind}`);
    return null;
  });
  if (!lists) return <SnapShell error="The price database isn't reachable right now. Try again in a minute." />;
  const [items, outlets] = lists;
  return <SnapFlow items={items} outlets={outlets} />;
}
