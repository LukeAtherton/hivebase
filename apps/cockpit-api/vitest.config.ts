import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests touch a real Postgres (the local dev compose stack).
    // Hits ./tests/**/*.test.ts only — the validate-autonomy.ts script lives
    // under scripts/ and isn't picked up.
    include: ['tests/**/*.test.ts'],
    // Each test orchestrates a wipe-and-seed; keep them serial.
    poolOptions: { threads: { singleThread: true } },
    // Loaded so DATABASE_URL is available without exporting in the shell.
    setupFiles: ['./tests/setup.ts'],
  },
});
