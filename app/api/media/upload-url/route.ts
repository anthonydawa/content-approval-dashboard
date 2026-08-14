import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const MAX_MEDIA_BYTES = 250 * 1024 * 1024;
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
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const publicBaseUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, "");

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return Response.json(
      { error: "Cloudflare R2 is not configured yet.", code: "r2_not_configured" },
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
    return Response.json({ error: "Files must be 250 MB or smaller." }, { status: 400 });
  }

  const key = `${workspaceId}/${contentId}-${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 300 });

  return Response.json(
    { uploadUrl, publicUrl: `${publicBaseUrl}/${key}` },
    { headers: { "Cache-Control": "no-store" } },
  );
}
