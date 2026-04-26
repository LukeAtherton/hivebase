import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load root .env first, then local .env for overrides
dotenv.config({ path: join(__dirname, '../../../.env') });
dotenv.config({ path: join(__dirname, '../.env') });

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { loadConfig } from './config.js';
import { startPersistence } from './lib/persistence.js';
import { startCooldownScheduler, shutdownCooldownScheduler } from './lib/cooldown-scheduler.js';
import { startTickerFeed, shutdownTickerFeed } from './lib/ticker-feed.js';
import { startTerritoryPoller, shutdownTerritoryPoller } from './lib/territory-poller.js';
import { sweepOrphanSessions } from './lib/orphan-sweep.js';
import { registerHookRoutes } from './routes/hooks.js';
import { registerSpawnRoutes } from './routes/spawn.js';
import { registerScopeRoutes } from './routes/scope.js';
import { registerUploadRoutes } from './routes/uploads.js';
import { registerTickerRoutes } from './routes/ticker.js';
import { registerTerritoryRoutes } from './routes/territory.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerDecisionRoutes } from './routes/decisions.js';
import { registerStreamRoutes } from './routes/stream.js';

async function main() {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
    bodyLimit: 4 * 1024 * 1024, // hook payloads can be chunky
  });

  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({ error: 'Validation error', issues: error.issues });
      return;
    }
    const err = error as { statusCode?: number; message?: string };
    reply.status(err.statusCode ?? 500).send({ error: err.message ?? 'Internal server error' });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  startPersistence();
  startCooldownScheduler(config.redisUrl);
  startTickerFeed(config.redisUrl);
  startTerritoryPoller();

  // Sweep orphan sessions left over from a previous run. Their claude
  // children died with the api but the DB rows still say 'implementing' —
  // mark them stale-zombie so the map and outliner are honest.
  try {
    const { swept } = await sweepOrphanSessions();
    if (swept > 0) app.log.info({ swept }, 'orphan-sweep marked sessions stale-zombie');
  } catch (err) {
    app.log.error({ err }, 'orphan-sweep failed');
  }

  await registerHookRoutes(app);
  await registerProjectRoutes(app);
  await registerSpawnRoutes(app, config);
  await registerScopeRoutes(app, config);
  await registerUploadRoutes(app);
  await registerTickerRoutes(app);
  await registerTerritoryRoutes(app);
  await registerSessionRoutes(app);
  await registerDecisionRoutes(app);
  await registerStreamRoutes(app);

  await app.listen({ port: config.port, host: '0.0.0.0' });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'cockpit-api shutdown');
    await shutdownCooldownScheduler();
    await shutdownTickerFeed();
    await shutdownTerritoryPoller();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
