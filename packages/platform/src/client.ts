import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index';

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getCockpitDb() {
  if (!db) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    db = drizzle(pool, { schema });
  }

  return db;
}

export async function closeCockpitDb() {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}

export { schema };
export type CockpitDb = ReturnType<typeof getCockpitDb>;
