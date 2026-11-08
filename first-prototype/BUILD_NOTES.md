# Campus Price Map: First Prototype (v0.1.0) Build Notes

> **FIRST PROTOTYPE.** These are notes for the next iteration: what was built, how, what went wrong and what to do
> next. Built 2026-11-07 in one session with Claude Code, on Databricks (Lakebase + Databricks Apps + AppKit).
> Git tag: `v0.1.0-first-prototype`. Code: this folder.

---

## 1. TL;DR for the next iteration

- **The full loop works end to end on sample data:** scan → share price → cheapest first → "Did you buy it?" →
  community confirmation, plus sold-out reports, a campus map, outlet pages and thank-yous.
- **Most reusable piece:** `server/domain/rules.ts`. It's pure TypeScript with no framework or database
  dependencies, covered by 26 unit tests. It holds every community-verification rule and can be copied into the
  planned Next.js build as is.
- **Second most reusable:** the Postgres schema and workflows in `server/db/setup.ts` and
  `server/domain/service.ts`: transactions, a per item/outlet advisory lock, supersession, reconfirmation dedup and
  sold-out lifecycle SQL.
- **Biggest blocker for real students:** Databricks Apps only admit signed-in workspace users. Real UBC students
  can't open this app. The planned Next.js + Vercel front end (root README) solves that, and Lakebase can stay as the
  database.
- **Not real yet:** prices, hours, coordinates and BC averages are sample data. Receipt photos aren't read. Student
  identity is an anonymous per-device ID that a determined user could fake.

---

## 2. What was built

### User-facing features (mapped to the product summary)

| # | Spec feature | Status in v0.1.0 | Where |
|---|---|---|---|
| 1 | Scanner-first home | ✅ Camera barcode scan (ZXing), typed barcode, "Demo: scan a Red Bull", "Just browsing? See the map", "No barcode? Pick your item" | `client/src/pages/ScanPage.tsx`, `components/Scanner.tsx` |
| 2 | "What's the price here?" | ✅ Big cash-register number pad, outlet suggestion (location within 120 m, else last used, else picker), skippable | `pages/ReportPage.tsx`, `components/NumberPad.tsx` |
| 3 | Results, cheapest first | ✅ In-stock first, then price. Savings headline ("You'd save 20 cents at …, 9 min walk" / "Nice, this is the cheapest on campus" / sold-out variant), current outlet highlighted, walking minutes, "Confirmed by N students, X ago", faded stale prices | `pages/ResultsPage.tsx` |
| 4 | Campus map | ✅ Leaflet + OpenStreetMap, pins with colour **and** `$`/`$$`/`$$$` text, legend, keyboard-accessible search combobox, list view | `pages/MapPage.tsx` |
| 5 | Outlet pages | ✅ Every item grouped by category with its own comparison ("Cheapest on campus", "23 cents above campus average", "2nd cheapest of 6") and a link to the cheaper option. No outlet-wide score | `pages/OutletPage.tsx` |
| 6 | "Did you buy it?" | ✅ Prefilled with the shelf price or official price, one tap to confirm, correct via number pad, optional receipt photo (stays on device). Triggers: "I bought it" button, 90 s on the results page at an outlet, next app open | `components/BoughtItSheet.tsx`, `lib/purchase.ts` |
| 7 | Sold-out reports | ✅ Possibly sold out → a second student confirms → sold out (expires after 4 h or at the end of the day) → "it's back" + confirmation. Unconfirmed reports expire after 1 h. Sold-out outlets drop below in-stock ones | `service.ts` (stock section) |
| 8 | "Vs BC average" badge | ⚠️ Works, but on **3 sample values**, clearly labelled as sample data and a provincial average | `seed-data.ts` `BC_AVERAGES` |
| 9 | 21 tracked items | ✅ 5 categories, fixed sizes | `seed-data.ts` `ITEMS` |
| 10 | Thank-yous | ✅ Toast "You just helped N students who search X each week", plus a You tab with weekly confirmations, reports, live prices and students helped | `lib/feedback.ts`, `pages/MePage.tsx` |
| — | Demo persona switcher | ➕ Student A/B/C on one device, so the "only someone else can confirm" rule can be demoed | `lib/student.ts`, You tab |

### Community-verification rules (`server/domain/rules.ts`)

| Situation | Confirmations needed from **other** students |
|---|---|
| Receipt photo, or a scan within 10% of the current price | 1 |
| The same student's shelf and checkout prices match | 1 (big-jump/trust rules still apply) |
| Scan with a moderate change, new listing, or receipt on a >25% jump | 2 |
| Typed price with no proof, or a >25% change | 3 |
| Outside 0.5× to 2× the campus median | **held**, 4 |
| Trusted (≥3 resolved, ≥80% confirmed) / often rejected (<40%) | −1 (never below 1) / +1 |

- Live when `yes ≥ required`. Discarded when `no > yes` and `no ≥ min(required, 2)`. "Not sure" is ignored.
- **No self-confirming** (server returns 403).
- **Independent matching reports:** a second student submitting the same price, who hasn't voted on that proposal
  and where `no ≤ yes`, makes it go live at once. Otherwise the submission counts as one more "yes".
- **When a price goes live:** other open proposals at the same price close as live (no trust credit), different
  prices close as `superseded`, confirmers are recorded so re-submitting can't double count, and
  `confirmed_by` = distinct students.
- **Same price as the official one:** a freshness reconfirmation, counted once per student per price.
- A pending proposal is **never** shown as the main price.

### Architecture

```
Phone browser ──HTTPS──▶ Databricks App (Node, AppKit server plugin, Express routes)
                              │  x-student-id header (anonymous per-device id)
                              ▼
                        Lakebase Postgres 17  (schema `cpm`, owned by the app's service principal)
```

- **Frontend:** React 19, react-router 7, Tailwind 4, AppKit UI (shadcn components), Leaflet, ZXing, sonner.
  Mobile-first with a bottom tab bar (Scan · Map · Items · You).
- **Backend:** `server/server.ts` → `setupDatabase()` (idempotent schema, migration and seed) → `registerApiRoutes()`.
  zod validation. All writes run in a transaction with `pg_advisory_xact_lock(hashtext(item|outlet))`.
- **API:** `GET /api/catalog`, `GET /api/items/by-barcode/:code`, `GET /api/items/:id/results?from=&lat=&lng=&log=1`,
  `GET /api/outlets/:id`, `GET /api/map?item=`, `POST /api/proposals`, `POST /api/proposals/:id/votes`,
  `POST /api/stock`, `POST /api/stock/:id/votes`, `GET /api/me`.
- **Tables (`cpm.*`):** `outlets`, `items`, `prices` (the official price per item/outlet; no row means not sold
  there), `proposals`, `votes`, `stock_reports`, `stock_votes`, `reconfirmations`, `searches`, `bc_averages`.
- **Design:** Databricks palette (navy `#0B2026`, lava `#FF3621`, oat `#EEEDE9`, cream `#F9F7F4`), DM Sans, light
  and dark tokens. Every text/background pair was checked to pass WCAG AA (4.5:1). Tap targets are 44 px or larger.

---

## 3. How it was built (in order)

1. **Intent.** Took the product summary as the spec. Chose: working prototype, the user's existing workspace, seed
   data first, demo audience (just us).
2. **Environment.** Installed the Databricks CLI (Homebrew), installed the Databricks agent skills, ran OAuth
   `auth login` into a new profile, and smoke-tested with `current-user me`.
3. **Lakebase.** `databricks postgres create-project campus-price-map`, which auto-creates the `production` branch,
   `primary` endpoint and `databricks-postgres` database.
4. **Scaffold.** Ran `databricks apps manifest`, then
   `databricks apps init --features lakebase --set lakebase.postgres.{project,branch,database}=… --package-manager npm`.
   Removed the template's todo example.
5. **Backend first.** Shared types, then pure rules plus tests, then seed data, then schema/setup, then the service
   layer, then routes.
6. **Frontend.** Theme tokens, then lib (identity, API hook, formatting, catalog context, location, pending
   purchase), then components, then 7 pages, then the shell. Lazy-loaded the map (Leaflet chunk is 162 KB).
7. **Quality gates.** `tsc`, `eslint`, `appkit lint`, `vitest`, `databricks apps validate`.
8. **First deploy** (needed before local development; see §4.5).
9. **Multi-agent code review** across 4 dimensions (rules/SQL, API/security, frontend flows, accessibility/UI),
   with an adversarial verifier per dimension. **26 confirmed findings, all fixed**, 3 dropped.
10. **Redeploy, then live tests:** API scenario tests as three students against the real Lakebase database, plus
    visual checks of each screen at phone size.
11. **Shared:** labelled everything "first prototype", removed workspace details, PR #1 merged into `main`, tag
    `v0.1.0-first-prototype`, teammate access set up.

---

## 4. What we struggled with (and the fix)

### 4.1 Tooling and setup
- **Databricks CLI not installed, and Homebrew refused the tap.** `brew install databricks` failed with
  "untrusted tap". The user had to run `brew trust databricks/tap` themselves (it's a security setting). The first
  attempt didn't take effect, and running it in the app's terminal panel worked.
- **Skills version mismatch.** `databricks aitools` installs the plugin at v0.2.32, but Claude Code's plugin
  marketplace only serves v0.2.28. Workaround: `databricks aitools install --path <dir>` and read the skills from
  there. Reported to DevHub.
- **`apps init` defaults to pnpm**, which wasn't installed, so it failed hard. Fix: `--package-manager npm`.
- **TypeScript and lint friction:** `erasableSyntaxOnly` forbids constructor parameter properties on the client.
  `pg`'s overloaded `query` broke on a union type, fixed with a single `Queryable` interface.
  `no-misused-promises` / `no-floating-promises` flagged react-router v7's `navigate()`, which returns a Promise, so
  calls are wrapped in `void`. `react/no-unescaped-entities` was turned off on purpose for readable copy.

### 4.2 Lakebase ownership: the biggest gotcha
- **Deploy first.** The app's service principal must create, and therefore own, the schema. If you run locally
  first, the schema ends up owned by you and the deployed app gets "permission denied".
- **Then local development broke anyway:** "must be owner of table proposals". Postgres checks ownership **before**
  `IF NOT EXISTS`, so even `CREATE INDEX IF NOT EXISTS` fails for a non-owner. Fix: `setupDatabase()` checks
  `tableowner = current_user` and skips DDL when running locally. Migrations (v2: `superseded` status, `via_match`
  column) only run when needed, and only the deployed app can run them.
- `create-project` defaulted to a **24 h** suspend timeout at 1 CU, not the 5 min the skill describes. Lower it to
  save money.

### 4.3 Bugs the code review caught (26 confirmed, all fixed)
The most serious ones are worth remembering as design rules:
1. **Matching-report bypass.** Submitting the same price as a pending proposal made it go live at once, ignoring
   `required`, existing "No" votes, and whether you had already voted. Now: independent only if you haven't voted
   and `no ≤ yes`, otherwise it counts as a "yes".
2. **Stale proposals overwriting newer prices.** Fixed with `superseded` on go-live.
3. **Freshness farming.** One student re-submitting the official price kept refreshing "X min ago". Now one
   reconfirmation per student per price, and confirmers are recorded on go-live.
4. **Trust farming** by copying pending prices. Matching rows (`via_match`) don't count toward trust.
5. **A shelf/checkout match** forced `required = 1` even on big jumps or low trust. It now re-runs `assessProposal`.
6. **Any attached photo counted as receipt proof.** It can't be read yet, so a receipt on a >25% jump now needs 2.
7. **Pending purchase shared across demo personas** (B could confirm A's purchase in one tap). Now stored per
   persona.
8. **Sync validation errors returned 500s** (Express 4 behind AppKit). Now wrapped with
   `Promise.resolve().then(...)`, and `HttpError` exposes `statusCode`.
9. **Accessibility:** the map search wasn't keyboard-usable. White on lava `#FF3621` failed contrast (now
   `--brand-strong #D42A10`, 5.1:1). Some tap targets were 40 px.
10. **Other UI fixes:** "I bought it" with an unknown outlet guessed the cheapest outlet (now asks). The
    next-open prompt wasn't prefilled. The linger prompt showed after answering. There was no camera retry after a
    denial. A StrictMode double-mount could blank the video. `useQuery` showed the previous page's data on a new
    path. The headline said "cheapest" when the current outlet was sold out.

### 4.4 Found during live testing
- **CARTO basemap tiles now require an API key.** The map showed "API KEY REQUIRED". Switched to
  `tile.openstreetmap.org`, with a CSS invert/hue filter for dark mode.
- **The map didn't fill the screen** (a flex `h-full` vs `flex-1` issue), and the **Nest and Harvest pins overlap**
  (about 40 m apart). Pins within 150 m of an earlier pin now put their label below the point.
- **Oversized "Privacy" heading** (inherited `h2` size).
- **Scanner sweep animation** used `translateY(%)`, which is relative to the line itself, so it switched to animating
  `top`.

### 4.5 Testing the deployed app
- The built-in browser pane has its own cookies and wasn't signed in to Databricks, so the deployed URL bounced to
  the sign-in page. **Workaround:** ran `npm run dev` locally against the **same** Lakebase database, plus curl
  scenario tests as three students. Deployed health was confirmed with `databricks apps logs` (use `--tail-lines`).
- The user was also clicking in the same pane, so UI-driving tests moved to API tests.

### 4.6 Sharing with a teammate
- `databricks users create` gave the new user **no entitlements and no group**, so he saw "Unable to view page …
  Workspace access". Fix: add the `workspace-access` entitlement.
- The app's deployed source lives in the deployer's **private home** (`.bundle/campus-price-map`), so it showed as
  not shared. Fix: grant `CAN_MANAGE` on that folder.
- Claude Code's auto-mode safety check **blocked permission grants** (Postgres superuser, folder ACL). The user ran
  those commands by hand. Expect this again.
- The teammate's **cloud** Claude Code session pointed at his own empty workspace. Cloud sessions can't do browser
  OAuth and likely can't reach Postgres. Use a local Claude Code session for Lakebase work.
- **A personal access token was pasted into a chat.** Revoke it, and prefer OAuth (`databricks auth login`).

---

## 5. Known limits of v0.1.0

- **Sample data everywhere:** prices, hours, coordinates (approximate) and BC averages. Seed barcodes use the
  reserved EAN prefix `200…`, except Red Bull 250 ml, which uses its real EAN.
- **The live demo database contains test activity** from scenario testing (for example, Red Bull at The Nest is now
  $3.29, plus test students `test-student-*`).
- **Receipt and price-tag photos are not read.** There's no OCR or Gemini yet. Photos never leave the device.
- **Identity:** an anonymous per-device ID in a header that can be spoofed. The A/B/C switcher is demo-only.
- **Walking distance** is straight-line × 1.25 at 80 m/min. The results page only knows your position from the
  chosen outlet. The API accepts `lat`/`lng`, but the client doesn't send them yet.
- **"Staying at the outlet"** is approximated by a 90 s timer on the results page, not geofencing.
- **No end-to-end/UI tests.** Only the rules are unit-tested. The scenario checks were manual curl scripts.
- **Bundle:** the main chunk is about 1 MB (300 KB gzipped). ZXing could be lazy-loaded.
- **Ops:** the platform logs "App did not respect SIGTERM timeout of 15 seconds" on redeploy (harmless so far).
  There are 5 fast-refresh lint warnings.

---

## 6. Recommendations for the next iteration

1. **Decide the hosting split.** For real students, serve the UI from **Next.js on Vercel** (as the root README
   plans) and keep **Lakebase** as the database. Port `rules.ts` verbatim and reuse the `cpm` schema and the
   service-layer SQL. Keep the Databricks App as an internal demo or admin tool if useful.
2. **Make receipts real.** Use Gemini (or a Databricks vision model / `ai_parse_document`) to read the tag or
   receipt, and only send `evidence: 'receipt'` when the extracted total matches the entered price. Then the receipt
   rule can return to "1 confirmation even on big jumps".
3. **Real identity and abuse limits:** sign-in (or a signed device token), and per-device rate limits (the README
   suggests about 10 reports a minute). The rules already assume one ID per real student.
4. **Real data:** load the price-walk sheet into `prices` (`source = walk`), real outlet hours and OSM coordinates,
   and the StatCan 18-10-0245-01 notebook → Delta → synced table into `bc_averages` (`is_sample = false`).
5. **Location:** send `lat`/`lng` to the results API and implement the README's "closest first, then cheapest"
   ordering, plus the term-savings line ("80 cents × 4 a week × 12 weeks ≈ $38").
6. **Tests:** add Playwright journeys (scan → share → results → buy → confirm as B) and integration tests for
   `service.ts` on a Lakebase **branch** (cheap copy-on-write).
7. **Ops hygiene:** lower the Lakebase suspend timeout, reset demo data (`DROP SCHEMA cpm CASCADE` as the app
   service principal, or reseed), stop the app when not demoing, and handle SIGTERM.

---

## 7. Quick reference

```bash
npm install && npm test                              # 26 rule tests
databricks apps validate --profile <profile>         # typecheck, lint, build, tests
databricks apps deploy   --profile <profile>         # deploy (do this before local dev on a fresh DB)
npm run dev                                          # http://localhost:8000, needs .env (see README)
databricks apps logs campus-price-map --profile <profile> --tail-lines 200
databricks apps stop campus-price-map --profile <profile>
```

Key files: `server/domain/rules.ts` (rules) · `server/domain/service.ts` (workflows) · `server/db/setup.ts`
(schema and migrations) · `server/db/seed-data.ts` (sample data) · `client/src/pages/*` (screens) ·
`shared/types.ts` (API contract).
