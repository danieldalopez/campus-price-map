import type { Metadata } from "next";
import ScanScreen from "@/components/ScanScreen";

export const metadata: Metadata = { title: "Scan a barcode · Campus Price Map" };

/**
 * Scan a barcode (SPEC section 7, Step 16): the live back camera reads EAN and UPC codes, /api/barcode says
 * what the product is, and a tracked item opens its Results. Everything happens in the browser, so the page
 * itself is static.
 */
export default function ScanPage() {
  return <ScanScreen />;
}
