// Loaded with `node --import` before every test file (see "test" in package.json). Lets plain Node run the
// app's server code the way Next.js does:
//   - "@/x" resolves to src/x, and extensionless relative imports find their .ts / .tsx file;
//   - "next/server" is a small stub (route handlers only use `connection()` from it);
//   - src/lib/db.ts is swapped for tests/helpers/test-db.ts, which talks to the throwaway local Postgres
//     started by tests/helpers/pg.ts (no TLS), never Lakebase.
import * as nodeModule from "node:module";

// registerHooks is in Node 22.15+ but not in this project's @types/node yet.
type Resolved = { url: string; shortCircuit?: boolean };
type NextResolve = (specifier: string, context: unknown) => Resolved;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, nextResolve: NextResolve): Resolved }): void;
};

const SRC = new URL("../../src/", import.meta.url);
const NEXT_SERVER = new URL("./next-server.ts", import.meta.url).href;
const REAL_DB = new URL("lib/db.ts", SRC).href;
const TEST_DB = new URL("./test-db.ts", import.meta.url).href;

const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return { url: NEXT_SERVER, shortCircuit: true };

    let spec = specifier;
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), SRC).href;

    const local = spec.startsWith(".") || spec.startsWith("file:");
    if (!local || /\.[cm]?[jt]sx?$|\.json$/.test(spec)) {
      const resolved = nextResolve(spec, context);
      return resolved.url === REAL_DB ? { url: TEST_DB, shortCircuit: true } : resolved;
    }

    let lastError: unknown;
    for (const ext of EXTENSIONS) {
      try {
        const resolved = nextResolve(spec + ext, context);
        return resolved.url === REAL_DB ? { url: TEST_DB, shortCircuit: true } : resolved;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  },
});
