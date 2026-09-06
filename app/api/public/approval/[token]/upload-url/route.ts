import { contentBelongsToApprovalBatch } from "@/lib/server/public-approval";
import { prepareMediaUpload } from "@/lib/server/media-upload";
import { assertSameOrigin } from "@/lib/server/session";

const uploads = new Map<string, { count: number; resetAt: number }>();

function uploadLimit(request: Request) {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const current = uploads.get(address);
  const record = current && current.resetAt > now ? current : { count: 0, resetAt: now + 10 * 60_000 };
  if (record.count >= 20) return true;
  uploads.set(address, { ...record, count: record.count + 1 });
  return false;
}

export async function POST(request: Request, context: RouteContext<"/api/public/approval/[token]/upload-url">) {
  try {
    assertSameOrigin(request);
    if (uploadLimit(request)) {
      return Response.json({ error: "Too many uploads. Please wait a few minutes." }, { status: 429 });
    }
    const { token } = await context.params;
    const body = (await request.json()) as {
      contentId?: unknown;
      contentType?: unknown;
      size?: unknown;
    };
    if (typeof body.contentId !== "string") throw new Error("Invalid content item.");
    const match = await contentBelongsToApprovalBatch(token, body.contentId);
    if (!match) {
      return Response.json({ error: "This approval link or content item is invalid." }, { status: 404 });
    }
    const result = prepareMediaUpload({
      workspaceId: String(match.batch.workspace_id),
      contentId: String(match.content.id),
      contentType: typeof body.contentType === "string" ? body.contentType : "",
      size: typeof body.size === "number" ? body.size : Number.NaN,
    });
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (reason) {
    if (reason instanceof Response) return reason;
    return Response.json(
      { error: reason instanceof Error ? reason.message : "Invalid upload request." },
      { status: 400 },
    );
  }
}
