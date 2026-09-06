import { prepareMediaUpload } from "@/lib/server/media-upload";
import { assertSameOrigin, requireSession } from "@/lib/server/session";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireSession();
    const body = (await request.json()) as {
      workspaceId?: unknown;
      contentId?: unknown;
      contentType?: unknown;
      size?: unknown;
    };
    const result = prepareMediaUpload({
      workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : "",
      contentId: typeof body.contentId === "string" ? body.contentId : "",
      contentType: typeof body.contentType === "string" ? body.contentType : "",
      size: typeof body.size === "number" ? body.size : Number.NaN,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    if (reason instanceof Response) return reason;
    const message = reason instanceof Error ? reason.message : "Invalid upload request.";
    const status = message.includes("not configured") ? 503 : 400;
    return Response.json({ error: message }, { status });
  }
}
