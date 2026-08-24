import { createHmac, randomUUID } from "node:crypto";
import { assertSameOrigin, requireSession } from "@/lib/server/session";

const MAX_MEDIA_BYTES = 90 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

function cleanId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

export async function POST(request: Request) {
  assertSameOrigin(request);
  await requireSession();
  const mediaWorkerUrl = process.env.MEDIA_WORKER_URL?.replace(/\/$/, "");
  const signingSecret = process.env.UPLOAD_SIGNING_SECRET;

  if (!mediaWorkerUrl || !signingSecret) {
    return Response.json(
      { error: "Cloudflare media storage is not configured yet.", code: "media_not_configured" },
      { status: 503 },
    );
  }

  let body: { workspaceId?: string; contentId?: string; contentType?: string; size?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid upload request." }, { status: 400 });
  }

  const workspaceId = cleanId(body.workspaceId ?? "");
  const contentId = cleanId(body.contentId ?? "");
  const contentType = body.contentType ?? "";
  const extension = EXTENSIONS[contentType];

  if (!workspaceId || !contentId || !extension) {
    return Response.json({ error: "This file type is not supported." }, { status: 400 });
  }
  if (!Number.isFinite(body.size) || (body.size ?? 0) <= 0 || (body.size ?? 0) > MAX_MEDIA_BYTES) {
    return Response.json({ error: "Files must be 90 MB or smaller." }, { status: 400 });
  }

  const key = `${workspaceId}/${contentId}-${Date.now()}-${randomUUID()}.${extension}`;
  const expires = Math.floor(Date.now() / 1000) + 300;
  const signature = createHmac("sha256", signingSecret).update(`${key}:${expires}`).digest("hex");
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const uploadUrl = `${mediaWorkerUrl}/upload/${encodedKey}?expires=${expires}&signature=${signature}`;

  return Response.json(
    { uploadUrl, publicUrl: `${mediaWorkerUrl}/media/${encodedKey}` },
    { headers: { "Cache-Control": "no-store" } },
  );
}
