import "server-only";

import { createHmac, randomUUID } from "node:crypto";

export const MAX_MEDIA_BYTES = 90 * 1024 * 1024;

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

export function prepareMediaUpload(input: {
  workspaceId: string;
  contentId: string;
  contentType: string;
  size: number;
}) {
  const mediaWorkerUrl = process.env.MEDIA_WORKER_URL?.replace(/\/$/, "");
  const signingSecret = process.env.UPLOAD_SIGNING_SECRET;
  if (!mediaWorkerUrl || !signingSecret) {
    throw new Error("Cloudflare media storage is not configured yet.");
  }

  const workspaceId = cleanId(input.workspaceId);
  const contentId = cleanId(input.contentId);
  const extension = EXTENSIONS[input.contentType];
  if (!workspaceId || !contentId || !extension) {
    throw new Error("This file type is not supported.");
  }
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > MAX_MEDIA_BYTES) {
    throw new Error("Files must be 90 MB or smaller.");
  }

  const key = `${workspaceId}/${contentId}-${Date.now()}-${randomUUID()}.${extension}`;
  const expires = Math.floor(Date.now() / 1000) + 300;
  const signature = createHmac("sha256", signingSecret).update(`${key}:${expires}`).digest("hex");
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return {
    uploadUrl: `${mediaWorkerUrl}/upload/${encodedKey}?expires=${expires}&signature=${signature}`,
    publicUrl: `${mediaWorkerUrl}/media/${encodedKey}`,
  };
}
