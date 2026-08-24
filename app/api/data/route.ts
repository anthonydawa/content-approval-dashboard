import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { decryptSecret, encryptSecret } from "@/lib/server/secret-box";
import { assertSameOrigin, requireSession } from "@/lib/server/session";
import { getServerSupabase } from "@/lib/server/supabase-admin";
import { getZernioPost, listZernioAccounts, syncZernioPost } from "@/lib/server/zernio";
import type { QueueCadence, QueueItem, Workspace, ZernioAccount } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_CADENCE: QueueCadence = { frequency: "weekdays", weekdays: [1, 2, 3, 4, 5], times: ["09:00"], start_date: "" };

function id(value: unknown, name = "id") {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`Invalid ${name}.`);
  return value;
}

function text(value: unknown, maximum: number, fallback = "") {
  if (value == null) return fallback;
  if (typeof value !== "string") throw new Error("Invalid text value.");
  return value.trim().slice(0, maximum);
}

function ids(value: unknown, maximum = 500) {
  if (!Array.isArray(value) || !value.length || value.length > maximum) throw new Error("Choose at least one valid item.");
  return [...new Set(value.map((entry) => id(entry)))];
}

function externalIds(value: unknown, maximum = 100) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error("Choose valid Zernio accounts.");
  const entries = value.map((entry) => {
    if (typeof entry !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(entry)) {
      throw new Error("Choose valid Zernio accounts.");
    }
    return entry;
  });
  return [...new Set(entries)];
}

function validMediaUrl(value: unknown) {
  const url = text(value, 2048);
  if (!url) return "";
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Media must use HTTPS.");
  return parsed.toString();
}

function parseCadence(value: unknown): QueueCadence {
  const source = (value ?? {}) as Partial<QueueCadence>;
  const frequency = ["daily", "weekdays", "custom"].includes(source.frequency ?? "") ? source.frequency! : "weekdays";
  const weekdays = Array.isArray(source.weekdays)
    ? [...new Set(source.weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : DEFAULT_CADENCE.weekdays;
  const times = Array.isArray(source.times)
    ? [...new Set(source.times.filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)))].slice(0, 12)
    : DEFAULT_CADENCE.times;
  const startDate = typeof source.start_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source.start_date) ? source.start_date : "";
  if (!times.length || (frequency === "custom" && !weekdays.length)) throw new Error("Choose at least one valid day and time.");
  return { frequency, weekdays, times, start_date: startDate };
}

function jsonError(reason: unknown) {
  if (reason instanceof Response) return reason;
  return NextResponse.json({ error: reason instanceof Error ? reason.message : "The request failed." }, { status: 400 });
}

function workspaceDto(row: Record<string, unknown>): Workspace {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    initials: String(row.initials ?? ""),
    color: String(row.color ?? "#536f62"),
    timezone: String(row.timezone ?? DEFAULT_TIMEZONE),
    zernio_configured: Boolean(row.zernio_api_key_encrypted),
    zernio_accounts: Array.isArray(row.zernio_accounts) ? (row.zernio_accounts as ZernioAccount[]) : [],
    auto_queue_cadence: row.auto_queue_cadence && typeof row.auto_queue_cadence === "object"
      ? { ...DEFAULT_CADENCE, ...(row.auto_queue_cadence as QueueCadence) }
      : DEFAULT_CADENCE,
  };
}

export async function GET() {
  try {
    await requireSession();
    const supabase = getServerSupabase();
    const [workspaceResult, contentResult, queueResult] = await Promise.all([
      supabase.from("workspaces").select("id,name,initials,color,timezone,zernio_api_key_encrypted,zernio_accounts,auto_queue_cadence").order("created_at"),
      supabase.from("content_items").select("id,workspace_id,title,caption,media_url,media_type,channel,scheduled_for,status,position,comments(id,content_id,author,body,created_at)").order("position"),
      supabase.from("schedule_queue").select("id,workspace_id,source_content_id,title,caption,media_url,media_type,channel,scheduled_at,sync_state,zernio_post_id,zernio_status,zernio_last_error,zernio_request_id,sent_to_zernio_at,created_at,updated_at").order("scheduled_at", { nullsFirst: false }).order("created_at"),
    ]);
    const error = workspaceResult.error || contentResult.error || queueResult.error;
    if (error) throw error;
    return NextResponse.json({
      workspaces: (workspaceResult.data ?? []).map((row) => workspaceDto(row)),
      content: contentResult.data ?? [],
      queue: queueResult.data ?? [],
    });
  } catch (reason) {
    return jsonError(reason);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireSession();
    const body = (await request.json()) as Record<string, unknown>;
    const action = text(body.action, 50);
    const supabase = getServerSupabase();

    if (action === "createWorkspace") {
      const name = text(body.name, 80);
      if (!name) throw new Error("Enter a workspace name.");
      const color = text(body.color, 7);
      const row = {
        id: randomUUID(),
        name,
        initials: name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
        color: /^#[0-9a-f]{6}$/i.test(color) ? color : "#536f62",
        timezone: DEFAULT_TIMEZONE,
      };
      const { error } = await supabase.from("workspaces").insert(row);
      if (error) throw error;
      return NextResponse.json({ workspace: workspaceDto(row) });
    }

    if (action === "updateStatus") {
      const status = text(body.status, 30);
      if (!["pending", "approved", "changes_requested"].includes(status)) throw new Error("Invalid review status.");
      const { error } = await supabase.from("content_items").update({ status }).eq("id", id(body.id));
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "addComment") {
      const contentId = id(body.contentId, "content ID");
      const commentBody = text(body.body, 4000);
      if (!commentBody) throw new Error("Enter a comment.");
      const comment = { id: randomUUID(), content_id: contentId, author: "Reviewer", body: commentBody, created_at: new Date().toISOString() };
      const [commentResult, contentResult] = await Promise.all([
        supabase.from("comments").insert(comment),
        supabase.from("content_items").update({ status: "changes_requested" }).eq("id", contentId),
      ]);
      if (commentResult.error || contentResult.error) throw commentResult.error || contentResult.error;
      return NextResponse.json({ comment });
    }

    if (action === "addContent" || action === "bulkAddContent") {
      const rowsInput = action === "bulkAddContent" ? body.items : [body.item];
      if (!Array.isArray(rowsInput) || !rowsInput.length || rowsInput.length > 250) throw new Error("Choose between 1 and 250 content items.");
      const workspaceId = id(body.workspaceId, "workspace ID");
      const rows = rowsInput.map((entry, index) => {
        const value = (entry ?? {}) as Record<string, unknown>;
        return {
          id: id(value.id), workspace_id: workspaceId,
          title: text(value.title, 180), caption: text(value.caption, 10000),
          media_url: validMediaUrl(value.media_url), media_type: value.media_type === "video" ? "video" : "image",
          channel: text(value.channel, 50, "All platforms") || "All platforms",
          scheduled_for: "Not scheduled", status: "pending",
          position: Number.isInteger(value.position) ? value.position : index + 1,
        };
      });
      const { error } = await supabase.from("content_items").insert(rows);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "editContent") {
      const { error } = await supabase.from("content_items").update({
        title: text(body.title, 180), caption: text(body.caption, 10000),
        channel: text(body.channel, 50, "All platforms") || "All platforms",
        media_url: validMediaUrl(body.media_url), media_type: body.media_type === "video" ? "video" : "image", status: "pending",
      }).eq("id", id(body.id));
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "deleteContent") {
      const { error } = await supabase.from("content_items").delete().eq("id", id(body.id));
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "queueContent") {
      const workspaceId = id(body.workspaceId, "workspace ID");
      const contentIds = ids(body.contentIds);
      const { data, error } = await supabase.from("content_items")
        .select("id,workspace_id,title,caption,media_url,media_type,channel")
        .eq("workspace_id", workspaceId).in("id", contentIds);
      if (error) throw error;
      const rows = (data ?? []).map((item) => ({
        id: randomUUID(), workspace_id: workspaceId, source_content_id: item.id,
        title: item.title, caption: item.caption, media_url: item.media_url,
        media_type: item.media_type, channel: item.channel, zernio_request_id: randomUUID(),
      }));
      if (!rows.length) throw new Error("No matching content was found.");
      const { error: insertError } = await supabase.from("schedule_queue").upsert(rows, { onConflict: "workspace_id,source_content_id", ignoreDuplicates: true });
      if (insertError) throw insertError;
      return NextResponse.json({ added: rows.length });
    }

    if (action === "updateQueueSchedule") {
      const queueId = id(body.id);
      const scheduledAt = text(body.scheduledAt, 40);
      if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) throw new Error("Choose a valid date and time.");
      const { data: existing, error: readError } = await supabase.from("schedule_queue").select("zernio_post_id").eq("id", queueId).single();
      if (readError) throw readError;
      const { error } = await supabase.from("schedule_queue").update({
        scheduled_at: new Date(scheduledAt).toISOString(), sync_state: existing.zernio_post_id ? "dirty" : "not_sent", zernio_last_error: null,
      }).eq("id", queueId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "autoSchedule") {
      const workspaceId = id(body.workspaceId, "workspace ID");
      const assignments = body.assignments;
      const selectedCadence = parseCadence(body.cadence);
      if (!Array.isArray(assignments) || !assignments.length || assignments.length > 500) throw new Error("No auto-queue assignments were provided.");
      const updates = assignments.map((entry) => {
        const value = entry as Record<string, unknown>;
        const scheduledAt = text(value.scheduledAt, 40);
        if (Number.isNaN(Date.parse(scheduledAt))) throw new Error("Invalid auto-queue date.");
        return supabase.from("schedule_queue").update({ scheduled_at: new Date(scheduledAt).toISOString(), sync_state: "not_sent", zernio_last_error: null })
          .eq("workspace_id", workspaceId).eq("id", id(value.id));
      });
      const results = await Promise.all(updates);
      const updateError = results.find((result) => result.error)?.error;
      if (updateError) throw updateError;
      const { error } = await supabase.from("workspaces").update({ auto_queue_cadence: selectedCadence }).eq("id", workspaceId);
      if (error) throw error;
      return NextResponse.json({ scheduled: assignments.length });
    }

    if (action === "deleteQueue") {
      const { error } = await supabase.from("schedule_queue").delete().eq("id", id(body.id));
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "loadZernioAccounts") {
      const workspaceId = id(body.workspaceId, "workspace ID");
      const suppliedKey = text(body.apiKey, 200);
      let apiKey = suppliedKey;
      if (!apiKey) {
        const { data, error } = await supabase.from("workspaces").select("zernio_api_key_encrypted").eq("id", workspaceId).single();
        if (error) throw error;
        if (!data.zernio_api_key_encrypted) throw new Error("Enter a Zernio API key.");
        apiKey = decryptSecret(data.zernio_api_key_encrypted);
      }
      return NextResponse.json({ accounts: await listZernioAccounts(apiKey) });
    }

    if (action === "saveZernioConfig") {
      const workspaceId = id(body.workspaceId, "workspace ID");
      const suppliedKey = text(body.apiKey, 200);
      const timezone = text(body.timezone, 80, DEFAULT_TIMEZONE);
      try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { throw new Error("Choose a valid timezone."); }
      const { data: workspace, error: readError } = await supabase.from("workspaces").select("zernio_api_key_encrypted").eq("id", workspaceId).single();
      if (readError) throw readError;
      const apiKey = suppliedKey || (workspace.zernio_api_key_encrypted ? decryptSecret(workspace.zernio_api_key_encrypted) : "");
      if (!apiKey) throw new Error("Enter a Zernio API key.");
      const available = await listZernioAccounts(apiKey);
      const selectedIds = new Set(externalIds(body.accountIds));
      const selected = available.filter((account) => selectedIds.has(account.id));
      if (!selected.length) throw new Error("Select at least one connected account.");
      const { error } = await supabase.from("workspaces").update({
        timezone,
        zernio_api_key_encrypted: suppliedKey ? encryptSecret(suppliedKey) : workspace.zernio_api_key_encrypted,
        zernio_accounts: selected,
      }).eq("id", workspaceId);
      if (error) throw error;
      return NextResponse.json({ accounts: selected, timezone });
    }

    if (action === "syncZernio") {
      const workspaceId = id(body.workspaceId, "workspace ID");
      const queueIds = ids(body.queueIds, 250);
      const { data: workspace, error: workspaceError } = await supabase.from("workspaces")
        .select("timezone,zernio_api_key_encrypted,zernio_accounts").eq("id", workspaceId).single();
      if (workspaceError) throw workspaceError;
      if (!workspace.zernio_api_key_encrypted) throw new Error("Connect this workspace to Zernio first.");
      const apiKey = decryptSecret(workspace.zernio_api_key_encrypted);
      const accounts = (workspace.zernio_accounts ?? []) as ZernioAccount[];
      const timezone = workspace.timezone || DEFAULT_TIMEZONE;
      const { data, error } = await supabase.from("schedule_queue").select("*").eq("workspace_id", workspaceId).in("id", queueIds);
      if (error) throw error;
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const item of (data ?? []) as QueueItem[]) {
        try {
          if (item.zernio_status === "published") throw new Error("Published posts cannot be rescheduled.");
          const result = (await syncZernioPost(apiKey, item, accounts, timezone)) as {
            post?: { _id?: string; status?: string };
            existingPost?: { _id?: string; status?: string };
          };
          const post = result.post ?? ("existingPost" in result ? result.existingPost : undefined);
          const postId = post?._id ?? item.zernio_post_id;
          if (!postId) throw new Error("Zernio did not return a post ID.");
          const { error: updateError } = await supabase.from("schedule_queue").update({
            sync_state: "synced", zernio_post_id: postId, zernio_status: post?.status ?? "scheduled",
            zernio_last_error: null, sent_to_zernio_at: new Date().toISOString(),
          }).eq("id", item.id);
          if (updateError) throw updateError;
          results.push({ id: item.id, ok: true });
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : "Zernio sync failed.";
          await supabase.from("schedule_queue").update({ sync_state: "error", zernio_last_error: message.slice(0, 1000) }).eq("id", item.id);
          results.push({ id: item.id, ok: false, error: message });
        }
      }
      return NextResponse.json({ results });
    }

    if (action === "refreshZernio") {
      const workspaceId = id(body.workspaceId, "workspace ID");
      const { data: workspace, error: workspaceError } = await supabase.from("workspaces").select("zernio_api_key_encrypted").eq("id", workspaceId).single();
      if (workspaceError) throw workspaceError;
      if (!workspace.zernio_api_key_encrypted) throw new Error("This workspace is not connected to Zernio.");
      const apiKey = decryptSecret(workspace.zernio_api_key_encrypted);
      const { data, error } = await supabase.from("schedule_queue").select("id,zernio_post_id").eq("workspace_id", workspaceId).not("zernio_post_id", "is", null);
      if (error) throw error;
      let refreshed = 0;
      for (const item of data ?? []) {
        try {
          const result = await getZernioPost(apiKey, item.zernio_post_id!);
          if (result.post?.status) {
            await supabase.from("schedule_queue").update({ zernio_status: result.post.status, zernio_last_error: null }).eq("id", item.id);
            refreshed += 1;
          }
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : "Status check failed.";
          await supabase.from("schedule_queue").update({ zernio_last_error: message.slice(0, 1000) }).eq("id", item.id);
        }
      }
      return NextResponse.json({ refreshed });
    }

    throw new Error("Unknown action.");
  } catch (reason) {
    return jsonError(reason);
  }
}
