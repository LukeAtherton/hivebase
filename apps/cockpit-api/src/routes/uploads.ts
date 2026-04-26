// Image upload endpoint for the scoping surface.
//
// Operators dropping images into the seed-prompt editor flow through
// here. We persist to ~/.cockpit/uploads/<artifactId>/<filename> and
// return the absolute path. The seed prompt the implementation agent
// eventually sees contains the path verbatim, which the local Claude
// CLI can open since it runs on the same host.
//
// Limits:
//   - image/* only (png, jpeg, gif, webp)
//   - 8 MiB per file (matches Claude's image input cap)
//   - filenames are sanitized; collisions get a random suffix.

import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

export async function registerUploadRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: {
      fileSize: 8 * 1024 * 1024,
      files: 1,
    },
  });

  app.post('/scope/uploads', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.status(400).send({ error: 'no file' });

    if (!ALLOWED_MIME.has(file.mimetype)) {
      return reply.status(415).send({ error: `unsupported mimetype: ${file.mimetype}` });
    }

    const rawName = file.filename ?? 'image';
    const ext = extname(rawName).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return reply.status(415).send({ error: `unsupported extension: ${ext}` });
    }

    const artifactId = (req.query as { artifactId?: string }).artifactId ?? 'unscoped';
    const safeArtifact = artifactId.replace(/[^a-zA-Z0-9_-]/g, '');
    const dir = join(homedir(), '.cockpit', 'uploads', safeArtifact || 'unscoped');
    await mkdir(dir, { recursive: true });

    const baseName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
    const stem = baseName.endsWith(ext)
      ? baseName.slice(0, -ext.length)
      : baseName;
    const suffix = randomBytes(4).toString('hex');
    const fileName = `${stem || 'image'}-${suffix}${ext}`;
    const absPath = join(dir, fileName);

    const buf = await file.toBuffer();
    if (buf.byteLength > 8 * 1024 * 1024) {
      return reply.status(413).send({ error: 'file too large (max 8 MiB)' });
    }
    await writeFile(absPath, buf);

    return { path: absPath, filename: fileName, mimetype: file.mimetype, bytes: buf.byteLength };
  });
}
