import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { contentBelongsToApprovalBatch, loadPublicApproval } from "@/lib/server/public-approval";
import { assertSameOrigin } from "@/lib/server/session";
import { getServerSupabase } from "@/lib/server/supabase-admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requests = new Map<string, { count: number; resetAt: number }>();

function text(value: unknown, maximum: number, fallback = "") {
  if (value == null) return fallback;
  if (typeof value !== "string") throw new Error("Invalid text value.");
  return value.trim().slice(0, maximum);
}

function contentId(value: unknown) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("Invalid content item.");
  return value;
}

function mediaUrl(value: unknown) {
  const url = text(value, 2048);
  if (!url) return "";
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Media must use HTTPS.");
  return parsed.toString();
}

function limited(request: Request) {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const current = requests.get(address);
  const record = current && current.resetAt > now ? current : { count: 0, resetAt: now + 60_000 };
  if (record.count >= 120) return true;
  requests.set(address, { ...record, count: record.count + 1 });
  return false;
}

function response(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function GET(_request: Request, context: RouteContext<"/api/public/approval/[token]">) {
  try {
    const { token } = await context.params;
    const data = await loadPublicApproval(token);
    return data ? response(data) : response({ error: "This approval link is invalid or has been disabled." }, 404);
  } catch {
    return response({ error: "Could not load this approval batch." }, 500);
  }
}

export async function POST(request: Request, context: RouteContext<"/api/public/approval/[token]">) {
  try {
    assertSameOrigin(request);
    const { token } = await context.params;
    if (limited(request)) return response({ error: "Too many requests. Please wait a moment." }, 429);
    const body = (await request.json()) as Record<string, unknown>;
    const action = text(body.action, 30);
    const itemId = contentId(body.id ?? body.contentId);
    const match = await contentBelongsToApprovalBatch(token, itemId);
    if (!match) return response({ error: "This content is not part of this approval batch." }, 404);
    const batch = match.batch;
    const supabase = getServerSupabase();

    if (action === "approve") {
      const { error } = await supabase.from("content_items")
        .update({ status: "approved" })
        .eq("id", itemId)
        .eq("approval_batch_id", batch.id);
      if (error) throw error;
      return response({ ok: true });
    }

    if (action === "addComment") {
      const commentBody = text(body.body, 4000);
      if (!commentBody) throw new Error("Enter a comment.");
      const comment = {
        id: randomUUID(),
        content_id: itemId,
        author: "Client reviewer",
        body: commentBody,
        created_at: new Date().toISOString(),
      };
      const { error: commentError } = await supabase.from("comments").insert(comment);
      if (commentError) throw commentError;
      const { error: statusError } = await supabase.from("content_items")
        .update({ status: "changes_requested" })
        .eq("id", itemId)
        .eq("approval_batch_id", batch.id);
      if (statusError) throw statusError;
      return response({ comment });
    }

    if (action === "edit") {
      const update = {
        title: text(body.title, 180),
        caption: text(body.caption, 10000),
        channel: text(body.channel, 50, "All platforms") || "All platforms",
        media_url: mediaUrl(body.media_url),
        media_type: body.media_type === "video" ? "video" : "image",
        status: "pending",
      };
      const { error } = await supabase.from("content_items")
        .update(update)
        .eq("id", itemId)
        .eq("approval_batch_id", batch.id);
      if (error) throw error;
      return response({ item: { ...match.content, ...update } });
    }

    if (action === "delete") {
      const { data, error } = await supabase.from("content_items")
        .delete()
        .eq("id", itemId)
        .eq("approval_batch_id", batch.id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) return response({ error: "This content was not found." }, 404);
      return response({ ok: true });
    }

    return response({ error: "This action is not available on an approval link." }, 400);
  } catch (reason) {
    if (reason instanceof Response) return reason;
    return response({ error: reason instanceof Error ? reason.message : "The request failed." }, 400);
  }
}
