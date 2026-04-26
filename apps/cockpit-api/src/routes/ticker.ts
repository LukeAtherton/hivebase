// GET /ticker — backfill the news ticker on client mount.
// Returns the most recent N important events from Redis (newest first).

import type { FastifyInstance } from 'fastify';
import { readTicker } from '../lib/ticker-feed.js';

export async function registerTickerRoutes(app: FastifyInstance) {
  app.get('/ticker', async (req) => {
    const q = (req.query as { limit?: string }).limit;
    const limit = Math.max(1, Math.min(200, Number(q ?? 60) || 60));
    const items = await readTicker(limit);
    return { items };
  });
}
