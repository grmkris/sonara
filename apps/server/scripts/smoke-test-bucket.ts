/*
 * One-off bucket smoke test. Uploads a tiny PNG, generates a presigned
 * read URL, prints it. Verifies the Bun S3Client ↔ Railway-bucket
 * integration without involving the DB.
 *
 * Run via:
 *   railway run --service server -- bun apps/server/scripts/smoke-test-bucket.ts
 *
 * Or locally, with S3_* vars exported in your shell.
 */
import { isConfigured, presignReadUrl, uploadBytes } from "../src/storage/bucket";

async function main() {
  if (!isConfigured()) {
    console.error("bucket not configured — S3_* env vars missing");
    process.exit(1);
  }

  // 1x1 transparent PNG (67 bytes).
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  const key = `smoke-test/${Date.now()}.png`;

  console.log(`[1/2] uploading ${png.byteLength} bytes to ${key} ...`);
  await uploadBytes(key, png, "image/png");
  console.log("       upload ok");

  console.log("[2/2] presigning read URL ...");
  const url = presignReadUrl(key, 60); // 60s TTL — disposable
  console.log("       URL:");
  console.log("       " + url);
  console.log("\nverify with:  curl -I '<URL above>'  →  HTTP/1.1 200");
}

main().catch((err) => {
  console.error("smoke test failed:", err);
  process.exit(1);
});
