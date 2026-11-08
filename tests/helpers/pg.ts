// A throwaway local Postgres for tests: initdb into a temp folder, start it on a free port, load db/schema.sql,
// db/views.sql, db/roles.sql (with test passwords) and db/seed.sql, exactly as Lakebase was set up.
// Never touches Lakebase or .env.local. Returns null when Postgres isn't installed, so those tests skip.
//
// Postgres binaries: $PGBIN, else Homebrew's postgresql@17, else whatever `initdb` is on PATH.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

export type TestPg = {
  owner: pg.Pool;
  readerUrl: string;
  writerUrl: string;
  stop: () => Promise<void>;
};

const REPO = new URL("../../", import.meta.url).pathname;

function findBin(): string | null {
  const candidates = [process.env.PGBIN, "/opt/homebrew/opt/postgresql@17/bin", "/usr/local/opt/postgresql@17/bin"];
  for (const dir of candidates) if (dir && existsSync(join(dir, "initdb"))) return dir;
  try {
    const initdb = execFileSync("which", ["initdb"], { encoding: "utf8" }).trim();
    return initdb ? initdb.replace(/\/initdb$/, "") : null;
  } catch {
    return null;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

export const SKIP_REASON = "Postgres isn't installed (set PGBIN to its bin folder to run these tests)";

export async function startTestPg(): Promise<TestPg | null> {
  const bin = findBin();
  if (!bin) return null;

  const dir = mkdtempSync(join(tmpdir(), "cpm-test-pg-"));
  const data = join(dir, "data");
  const port = await freePort();
  // On macOS the postmaster refuses to start without a valid LC_ALL ("postmaster became multithreaded").
  const quiet = { stdio: "ignore" as const, env: { ...process.env, LC_ALL: "en_US.UTF-8", LANG: "en_US.UTF-8" } };

  try {
    execFileSync(join(bin, "initdb"), ["-D", data, "-U", "owner", "--auth=trust", "-E", "UTF8", "--locale=C"], quiet);
    execFileSync(
      join(bin, "pg_ctl"),
      ["-D", data, "-l", join(dir, "log"), "-w", "-o", `-p ${port} -c listen_addresses=127.0.0.1 -k ''`, "start"],
      quiet,
    );
  } catch (err) {
    const log = existsSync(join(dir, "log")) ? readFileSync(join(dir, "log"), "utf8").trim().split("\n").slice(-3) : [];
    rmSync(dir, { recursive: true, force: true });
    throw new Error([(err as Error).message.split("\n")[0], ...log].join("\n"));
  }

  const base = `postgres://owner@127.0.0.1:${port}`;
  const admin = new pg.Client({ connectionString: `${base}/postgres` });
  await admin.connect();
  await admin.query("create database cpm");
  await admin.end();

  const owner = new pg.Pool({ connectionString: `${base}/cpm`, max: 2 });
  const sql = (file: string) => readFileSync(join(REPO, "db", file), "utf8");
  const roles = sql("roles.sql")
    .replaceAll("<READER_PASSWORD>", "test-reader-pw")
    .replaceAll("<WRITER_PASSWORD>", "test-writer-pw");
  for (const text of [sql("schema.sql"), sql("views.sql"), roles, sql("seed.sql")]) await owner.query(text);

  return {
    owner,
    readerUrl: `postgres://app_reader:test-reader-pw@127.0.0.1:${port}/cpm`,
    writerUrl: `postgres://app_writer:test-writer-pw@127.0.0.1:${port}/cpm`,
    async stop() {
      await owner.end();
      try {
        execFileSync(join(bin, "pg_ctl"), ["-D", data, "-m", "immediate", "stop"], quiet);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
