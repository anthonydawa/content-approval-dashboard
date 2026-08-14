export const MAX_MEDIA_BYTES = 90 * 1024 * 1024;
export const MEDIA_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime";

type UploadResult = { uploadUrl: string; publicUrl: string };

export async function uploadToR2(file: File, workspaceId: string, contentId: string) {
  if (file.size > MAX_MEDIA_BYTES) throw new Error("Choose a file that is 90 MB or smaller.");

  const response = await fetch("/api/media/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, contentId, contentType: file.type, size: file.size }),
  });

  const result = await response.json() as Partial<UploadResult> & { error?: string; code?: string };
  if (!response.ok || !result.uploadUrl || !result.publicUrl) {
    throw new Error(result.error || "Could not prepare the media upload.");
  }

  const upload = await fetch(result.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!upload.ok) throw new Error("The media upload did not finish. Please try again.");

  return result.publicUrl;
}
