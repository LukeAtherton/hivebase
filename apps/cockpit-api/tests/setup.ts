// Loads the workspace root .env (where DATABASE_URL/REDIS_URL live) so
// integration tests can boot a DB connection without per-shell exports.

import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not set — integration tests need the local docker DB');
}
// Refuse to run against anything but the local docker port. Same guard as
// the seed script — dropping data into a foreign DB would be bad.
if (!process.env.DATABASE_URL.includes(':5433/') || !process.env.DATABASE_URL.includes('swarm')) {
  throw new Error(`Refusing: DATABASE_URL must point at local docker (got: ${process.env.DATABASE_URL})`);
}
