import { fal } from "@fal-ai/client";
import { getAuth } from "@/server/auth";
import { env } from "@/env";

// Image-anchor upload. Multipart POST → Better Auth session check →
// validate file → forward to fal.storage.upload() → return the fal-hosted
// URL. The browser then calls oRPC `setImageAnchor({ url, strength })` to
// pin it on the live Bun-server Session.
//
// No DB row is written. The fal URL lives on the Session in memory and
// drops on disconnect. Anon users are 401'd (the upload zone is also
// authed-only on the client, this is defence in depth).

// Force the route to run at request time so env.FAL_KEY and the auth
// session are available. Without this, Next.js may try to evaluate the
// route during the page-data collection pass at build time.
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

let configured = false;
function configureFal(): void {
  if (configured) return;
  // fal.config is module-scoped global; safe to call once. We don't use the
  // streamed credentials option because uploads run server-side under our
  // FAL_KEY, not a client-side proxy.
  fal.config({ credentials: env.FAL_KEY });
  configured = true;
}

export async function POST(req: Request): Promise<Response> {
  if (!env.FAL_KEY) {
    return Response.json(
      { error: "upload_not_configured" },
      { status: 503 },
    );
  }

  const auth = getAuth();
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "invalid_multipart" }, { status: 400 });
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return Response.json({ error: "missing_image_field" }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return Response.json(
      { error: "unsupported_mime", got: file.type },
      { status: 422 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: "file_too_large", maxBytes: MAX_BYTES },
      { status: 422 },
    );
  }

  configureFal();

  try {
    const url = await fal.storage.upload(file);
    return Response.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("upload/image: fal.storage.upload failed", {
      userId: session.user?.id,
      message,
    });
    return Response.json(
      { error: "upload_failed", message },
      { status: 502 },
    );
  }
}
