import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../../.env') });

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  console.log('Connecting to database...');
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  console.log('Running cockpit migrations from:', join(__dirname, '../drizzle'));
  await migrate(db, {
    migrationsFolder: join(__dirname, '../drizzle'),
    migrationsTable: '__drizzle_migrations_cockpit',
  });

  console.log('Cockpit migrations completed successfully!');
  await pool.end();
}

main().catch((err) => {
  console.error('Cockpit migration failed:', err);
  process.exit(1);
});
