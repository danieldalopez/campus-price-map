import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    // Claude Code session files, including leftover worktrees with their own copies of the app.
    ".claude/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Reference only: the earlier Databricks App prototype has its own tooling.
    "first-prototype/**",
  ]),
]);

export default eslintConfig;
