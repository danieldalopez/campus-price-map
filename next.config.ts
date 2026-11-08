import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // /api/barcode reads the bundled Open Food Facts extract at request time: make sure Vercel ships it.
  outputFileTracingIncludes: {
    "/api/barcode": ["./data/barcodes.csv"],
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
