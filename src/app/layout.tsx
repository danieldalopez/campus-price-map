import type { Metadata, Viewport } from "next";
import {
  Bricolage_Grotesque,
  Caveat,
  JetBrains_Mono,
  Source_Sans_3,
} from "next/font/google";
// Leaflet's stylesheet is imported once, here, for every map in the app (SPEC rule 9).
import "leaflet/dist/leaflet.css";
import "./globals.css";

// Headings and buttons
const bricolage = Bricolage_Grotesque({
  weight: "800",
  subsets: ["latin"],
  variable: "--font-bricolage",
});

// Body, 16 px minimum
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source-sans",
});

// Every price, tabular numbers
const jetbrains = JetBrains_Mono({
  weight: "700",
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

// Margin notes only: decorative, never the only place information appears
const caveat = Caveat({
  subsets: ["latin"],
  variable: "--font-caveat",
});

export const metadata: Metadata = {
  title: "Campus Price Map",
  description:
    "Find where the exact thing you buy every day is cheapest on UBC campus, close to where you are.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F4EEE2",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${sourceSans.variable} ${jetbrains.variable} ${caveat.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-paper font-sans text-ink">{children}</body>
    </html>
  );
}
