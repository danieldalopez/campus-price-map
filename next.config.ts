import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // These routes read bundled data files at request time: make sure Vercel ships them.
  outputFileTracingIncludes: {
    "/api/barcode": ["./data/barcodes.csv"],
    "/api/prices": ["./data/deals.csv"],
    "/api/outlet/[id]": ["./data/deals.csv"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
