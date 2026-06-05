import { S3Client } from "bun";

import { env } from "../env";

// Railway Bucket (Tigris-backed, S3-compatible). Used by persistFrame to
// store every generated frame for the library/timeline. Bucket is private;
// serving happens via presigned read URLs (presignReadUrl below).
//
// Configured via S3_* env vars (see env.ts). When any required field is
// empty (local dev without bucket creds), isConfigured() returns false and
// callers should skip persistence. We never throw at module load — the
// server boots regardless and persistFrame becomes a no-op.

let client: S3Client | null = null;

function getClient(): S3Client | null {
  if (client) {
    return client;
  }
  if (
    !env.S3_BUCKET ||
    !env.S3_ACCESS_KEY_ID ||
    !env.S3_SECRET_ACCESS_KEY ||
    !env.S3_ENDPOINT
  ) {
    return null;
  }
  client = new S3Client({
    accessKeyId: env.S3_ACCESS_KEY_ID,
    bucket: env.S3_BUCKET,
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  });
  return client;
}

export function isConfigured(): boolean {
  return getClient() !== null;
}

export async function uploadBytes(
  key: string,
  data: ArrayBuffer | Uint8Array | Blob,
  contentType: string
): Promise<void> {
  const c = getClient();
  if (!c) {
    throw new Error("bucket not configured");
  }
  await c.write(key, data, { type: contentType });
}

export function presignReadUrl(key: string, ttlSec?: number): string {
  const c = getClient();
  if (!c) {
    throw new Error("bucket not configured");
  }
  return c.presign(key, { expiresIn: ttlSec ?? env.S3_PRESIGN_TTL_SEC });
}

// If `url` is a (presigned) read URL pointing at OUR bucket, return its bare
// object key; otherwise null. Format-agnostic: handles both path-style
// (`<endpoint>/<bucket>/<key>`) and virtual-host style
// (`<bucket>.<endpoint>/<key>`). Lets persistFrame store a durable key for
// anchor inputs that came from the bucket, so they can be re-presigned on read
// instead of rotting when the original presign TTL lapses. External URLs
// (fal.storage uploads, public /library paths) return null and are kept as-is.
export function bucketKeyFromUrl(url: string): string | null {
  if (!env.S3_ENDPOINT || !env.S3_BUCKET) {
    return null;
  }
  let u: URL;
  let endpoint: URL;
  try {
    u = new URL(url);
    endpoint = new URL(env.S3_ENDPOINT);
  } catch {
    return null;
  }
  const hostOk =
    u.host === endpoint.host || u.host === `${env.S3_BUCKET}.${endpoint.host}`;
  if (!hostOk) {
    return null;
  }
  let path = u.pathname.replace(/^\/+/, "");
  if (path.startsWith(`${env.S3_BUCKET}/`)) {
    path = path.slice(env.S3_BUCKET.length + 1);
  }
  return path || null;
}
