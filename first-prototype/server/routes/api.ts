import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { Lakebase } from '../db/db';
import {
  castVote,
  findItemByBarcode,
  getCatalog,
  getItemResults,
  getMapPins,
  getMyStats,
  getOutletDetail,
  HttpError,
  reportStock,
  submitProposal,
  voteOnStockReport,
} from '../domain/service';

interface AppKitHandle {
  lakebase: Lakebase;
  server: { extend(fn: (app: Application) => void): void };
}

// Anonymous, per-device student id sent by the client. No names or emails are stored.
const STUDENT_ID = /^[a-z0-9-]{8,64}$/;

function studentId(req: Request): string {
  const id = req.header('x-student-id');
  if (!id || !STUDENT_ID.test(id)) throw new HttpError(400, 'Missing or invalid student id');
  return id;
}

const Slug = z.string().regex(/^[a-z0-9-]{1,64}$/);

const ProposalBody = z.object({
  itemId: Slug,
  outletId: Slug,
  priceCents: z.number().int().min(1).max(10_000),
  kind: z.enum(['shelf', 'checkout']),
  evidence: z.enum(['typed', 'scan', 'receipt']),
});

const VoteBody = z.object({ vote: z.enum(['yes', 'no', 'unsure']) });
const StockBody = z.object({ itemId: Slug, outletId: Slug, kind: z.enum(['out', 'back']) });
const StockVoteBody = z.object({ vote: z.enum(['yes', 'no']) });

const ResultsQuery = z.object({
  from: Slug.optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  log: z.enum(['0', '1']).optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
}

function paramId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id');
  return id;
}

/** Wrap an async handler so thrown HttpErrors become JSON responses. */
const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req: Request, res: Response, _next: NextFunction) => {
    // Promise.resolve().then() so synchronous throws (validation) are caught here too.
    Promise.resolve()
      .then(() => fn(req, res))
      .then((body) => {
        if (!res.headersSent) res.json(body);
      })
      .catch((err: unknown) => {
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        console.error('[cpm] Request failed:', req.method, req.path, err);
        res.status(500).json({ error: 'Something went wrong. Please try again.' });
      });
  };

export function registerApiRoutes(appkit: AppKitHandle) {
  const db = appkit.lakebase;

  appkit.server.extend((app) => {
    app.get('/api/catalog', handle(() => getCatalog(db)));

    app.get(
      '/api/items/by-barcode/:code',
      handle(async (req) => {
        const code = String(req.params.code);
        if (!/^\d{6,14}$/.test(code)) throw new HttpError(400, 'Invalid barcode');
        const item = await findItemByBarcode(db, code);
        if (!item) throw new HttpError(404, "We don't track this item yet");
        return item;
      }),
    );

    app.get(
      '/api/items/:itemId/results',
      handle((req) => {
        const q = parse(ResultsQuery, req.query);
        const origin = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : null;
        return getItemResults(db, parse(Slug, req.params.itemId), studentId(req), {
          fromOutletId: q.from ?? null,
          origin,
          logSearch: q.log === '1',
        });
      }),
    );

    app.get('/api/outlets/:outletId', handle((req) => getOutletDetail(db, parse(Slug, req.params.outletId), studentId(req))));

    app.get(
      '/api/map',
      handle((req) => {
        const item = typeof req.query.item === 'string' && req.query.item ? parse(Slug, req.query.item) : null;
        return getMapPins(db, item, studentId(req));
      }),
    );

    app.post('/api/proposals', handle((req) => submitProposal(db, studentId(req), parse(ProposalBody, req.body))));

    app.post('/api/proposals/:id/votes', handle((req) => castVote(db, studentId(req), paramId(req), parse(VoteBody, req.body).vote)));

    app.post('/api/stock', handle((req) => reportStock(db, studentId(req), parse(StockBody, req.body))));

    app.post(
      '/api/stock/:id/votes',
      handle((req) => voteOnStockReport(db, studentId(req), paramId(req), parse(StockVoteBody, req.body).vote)),
    );

    app.get('/api/me', handle((req) => getMyStats(db, studentId(req))));
  });
}
