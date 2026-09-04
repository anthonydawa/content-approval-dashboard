import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { decryptSecret, encryptSecret } from "@/lib/server/secret-box";
import { assertSameOrigin, requireSession } from "@/lib/server/session";
import { getServerSupabase } from "@/lib/server/supabase-admin";
import { getZernioPost, listPinterestBoards, listZernioAccounts, listZernioPosts, publishZernioPost, syncZernioPost, type ZernioPost } from "@/lib/server/zernio";
import type { QueueCadence, QueueItem, Workspace, ZernioAccount } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_CADENCE: QueueCadence = { frequency: "weekdays", weekdays: [1, 2, 3, 4, 5], times: ["09:00"], start_date: "" };
const PRIMARY_PLATFORMS = ["facebook", "instagram"];
const SECONDARY_PLATFORMS = ["linkedin", "pinterest"];

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
    zernio_secondary_configured: Boolean(row.zernio_secondary_api_key_encrypted),
    zernio_secondary_accounts: Array.isArray(row.zernio_secondary_accounts) ? (row.zernio_secondary_accounts as ZernioAccount[]) : [],
    pinterest_board_id: String(row.pinterest_board_id ?? ""),
    pinterest_board_name: String(row.pinterest_board_name ?? ""),
    auto_queue_cadence: row.auto_queue_cadence && typeof row.auto_queue_cadence === "object"
      ? { ...DEFAULT_CADENCE, ...(row.auto_queue_cadence as QueueCadence) }
      : DEFAULT_CADENCE,
  };
}

function accountId(value: string | { _id?: string; id?: string } | undefined) {
  if (typeof value === "string") return value;
  return value?._id ?? value?.id ?? "";
}

function requestedPlatform(channel: string) {
  const normalized = channel.toLowerCase();
  return [...PRIMARY_PLATFORMS, ...SECONDARY_PLATFORMS].find((platform) => normalized.includes(platform)) ?? null;
}

function scheduleFingerprint(value: string | undefined) {
  const parsed = Date.parse(value ?? "");
  return Number.isNaN(parsed) ? String(value ?? "") : new Date(parsed).toISOString();
}

function postFingerprint(post: ZernioPost) {
  const media = (post.mediaItems ?? []).map((item) => `${item.type ?? ""}:${item.url ?? ""}`).sort().join("|");
  return `${post.content ?? ""}|${media}`;
}

export async function GET() {
  try {
    await requireSession();
    const supabase = getServerSupabase();
    const [workspaceResult, contentResult, queueResult] = await Promise.all([
      supabase.from("workspaces").select("id,name,initials,color,timezone,zernio_api_key_encrypted,zernio_accounts,zernio_secondary_api_key_encrypted,zernio_secondary_accounts,pinterest_board_id,pinterest_board_name,auto_queue_cadence").order("created_at"),
      supabase.from("content_items").select("id,workspace_id,title,caption,media_url,media_type,channel,scheduled_for,status,position,comments(id,content_id,author,body,created_at)").order("position"),
      supabase.from("schedule_queue").select("id,workspace_id,source_content_id,title,caption,media_url,media_type,channel,scheduled_at,sync_state,zernio_post_id,zernio_status,zernio_last_error,zernio_request_id,sent_to_zernio_at,secondary_sync_state,secondary_zernio_post_id,secondary_zernio_status,secondary_zernio_last_error,secondary_zernio_request_id,secondary_sent_to_zernio_at,created_at,updated_at").order("scheduled_at", { nullsFirst: false }).order("created_at"),
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
        media_type: item.media_type, channel: item.channel, zernio_request_id: randomUUID(), secondary_zernio_request_id: randomUUID(),
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
      const { data: existing, error: readError } = await supabase.from("schedule_queue").select("zernio_post_id,secondary_zernio_post_id").eq("id", queueId).single();
      if (readError) throw readError;
      const { error } = await supabase.from("schedule_queue").update({
        scheduled_at: new Date(scheduledAt).toISOString(),
        sync_state: existing.zernio_post_id ? "dirty" : "not_sent",
        secondary_sync_state: existing.secondary_zernio_post_id ? "dirty" : "not_sent",
        zernio_last_error: null,
        secondary_zernio_last_error: null,
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
        return supabase.from("schedule_queue").update({ scheduled_at: new Date(scheduledAt).toISOString(), sync_state: "not_sent", secondary_sync_state: "not_sent", zernio_last_error: null, secondary_zernio_last_error: null })
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

    if (action === "clearUnsentQueue") {
      const workspaceId = id(body.workspaceId, "workspace ID");
      const { data: unsent, error: readError } = await supabase.from("schedule_queue")
        .select("id").eq("workspace_id", workspaceId).is("scheduled_at", null).is("zernio_post_id", null).is("secondary_zernio_post_id", null);
      if (readError) throw readError;
      if (!unsent?.length) return NextResponse.json({ removed: 0, kept: 0 });
      const { error } = await supabase.from("schedule_queue").delete()
        .eq("workspace_id", workspaceId).is("scheduled_at", null).is("zernio_post_id", null).is("secondary_zernio_post_id", null);
      if (error) throw error;
      const { count: kept, error: keptError } = await supabase.from("schedule_queue")
        .select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
      if (keptError) throw keptError;
      return NextResponse.json({ removed: unsent.length, kept: kept ?? 0 });
    }

    if (action === "loadZernioAccounts") {
      const workspaceId = id(body.workspaceId, "workspace ID");
      const suppliedKey = text(body.apiKey, 200);
      const keySlot = body.keySlot === "secondary" ? "secondary" : "primary";
      const keyColumn = keySlot === "secondary" ? "zernio_secondary_api_key_encrypted" : "zernio_api_key_encrypted";
      let apiKey = suppliedKey;
      if (!apiKey) {
        const { data, error } = await supabase.from("workspaces").select("zernio_api_key_encrypted,zernio_secondary_api_key_encrypted").eq("id", workspaceId).single();
        if (error) throw error;
        const encrypted = data[keyColumn] as string | null;
        if (!encrypted) throw new Error("Enter a Zernio API key.");
        apiKey = decryptSecret(encrypted);
      }
      const supported = keySlot === "secondary" ? SECONDARY_PLATFORMS : PRIMARY_PLATFORMS;
      const accounts = (await listZernioAccounts(apiKey)).filter((account) => supported.includes(account.platform.toLowerCase()));
      return NextResponse.json({ accounts });
    }

    if (action === "loadPinterestBoards") {
      const workspaceId = id(body.workspaceId, "workspace ID");
      const accountId = text(body.accountId, 100);
      if (!accountId) throw new Error("Choose a Pinterest account first.");
      const suppliedKey = text(body.apiKey, 200);
      const { data, error } = await supabase.from("workspaces").select("zernio_secondary_api_key_encrypted").eq("id", workspaceId).single();
      if (error) throw error;
      const apiKey = suppliedKey || (data.zernio_secondary_api_key_encrypted ? decryptSecret(data.zernio_secondary_api_key_encrypted) : "");
      if (!apiKey) throw new Error("Enter the LinkedIn / Pinterest Zernio API key first.");
      return NextResponse.json({ boards: await listPinterestBoards(apiKey, accountId) });
    }

    if (action === "publishNow") {
      const workspaceId = id(body.workspaceId, "workspace ID");
      const queueId = id(body.id, "queue ID");
      const { data: workspace, error: workspaceError } = await supabase.from("workspaces")
        .select("timezone,zernio_api_key_encrypted,zernio_accounts,zernio_secondary_api_key_encrypted,zernio_secondary_accounts,pinterest_board_id").eq("id", workspaceId).single();
      if (workspaceError) throw workspaceError;
      if (!workspace.zernio_api_key_encrypted && !workspace.zernio_secondary_api_key_encrypted) throw new Error("Connect this workspace to Zernio first.");
      const { data: queueItem, error: queueError } = await supabase.from("schedule_queue")
        .select("*").eq("id", queueId).eq("workspace_id", workspaceId).single();
      if (queueError) throw queueError;
      if (queueItem.zernio_post_id || queueItem.secondary_zernio_post_id || queueItem.zernio_status === "published" || queueItem.secondary_zernio_status === "published") {
        throw new Error("This post has already been sent to Zernio.");
      }
      const timezone = workspace.timezone || DEFAULT_TIMEZONE;
      const item = queueItem as QueueItem;
      const deliveries = [
        workspace.zernio_api_key_encrypted && {
          slot: "primary", apiKey: decryptSecret(workspace.zernio_api_key_encrypted), accounts: (workspace.zernio_accounts ?? []) as ZernioAccount[],
          allowedPlatforms: PRIMARY_PLATFORMS, requestId: item.zernio_request_id,
        },
        workspace.zernio_secondary_api_key_encrypted && {
          slot: "secondary", apiKey: decryptSecret(workspace.zernio_secondary_api_key_encrypted), accounts: (workspace.zernio_secondary_accounts ?? []) as ZernioAccount[],
          allowedPlatforms: SECONDARY_PLATFORMS, requestId: item.secondary_zernio_request_id,
        },
      ].filter(Boolean) as Array<{ slot: "primary" | "secondary"; apiKey: string; accounts: ZernioAccount[]; allowedPlatforms: string[]; requestId: string }>;
      const postIds: string[] = [];
      for (const delivery of deliveries) {
        const deliveryItem = { ...item, zernio_request_id: delivery.requestId };
        const result = await publishZernioPost(delivery.apiKey, deliveryItem, delivery.accounts, timezone, {
          allowedPlatforms: delivery.allowedPlatforms,
          pinterestBoardId: workspace.pinterest_board_id,
        }) as { post?: { _id?: string; status?: string }; existingPost?: { _id?: string; status?: string } };
        const post = result.post ?? result.existingPost;
        if (!post?._id) throw new Error(`Zernio did not return a ${delivery.slot} published post ID.`);
        const update = delivery.slot === "primary"
          ? { sync_state: "synced", zernio_post_id: post._id, zernio_status: "published", zernio_last_error: null, sent_to_zernio_at: new Date().toISOString() }
          : { secondary_sync_state: "synced", secondary_zernio_post_id: post._id, secondary_zernio_status: "published", secondary_zernio_last_error: null, secondary_sent_to_zernio_at: new Date().toISOString() };
        const { error: updateError } = await supabase.from("schedule_queue").update(update).eq("id", queueId);
        if (updateError) throw updateError;
        postIds.push(post._id);
      }
      return NextResponse.json({ ok: true, postIds });
    }

    if (action === "saveZernioConfig") {
      const workspaceId = id(body.workspaceId, "workspace ID");
      const suppliedPrimaryKey = text(body.primaryApiKey, 200);
      const suppliedSecondaryKey = text(body.secondaryApiKey, 200);
      const timezone = text(body.timezone, 80, DEFAULT_TIMEZONE);
      try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { throw new Error("Choose a valid timezone."); }
      const { data: workspace, error: readError } = await supabase.from("workspaces").select("zernio_api_key_encrypted,zernio_secondary_api_key_encrypted").eq("id", workspaceId).single();
      if (readError) throw readError;
      const primaryKey = suppliedPrimaryKey || (workspace.zernio_api_key_encrypted ? decryptSecret(workspace.zernio_api_key_encrypted) : "");
      const secondaryKey = suppliedSecondaryKey || (workspace.zernio_secondary_api_key_encrypted ? decryptSecret(workspace.zernio_secondary_api_key_encrypted) : "");
      if (!primaryKey) throw new Error("Enter the Facebook / Instagram Zernio API key.");
      const primaryIds = new Set(externalIds(body.primaryAccountIds));
      const primaryAvailable = (await listZernioAccounts(primaryKey)).filter((account) => PRIMARY_PLATFORMS.includes(account.platform.toLowerCase()));
      const primarySelected = primaryAvailable.filter((account) => primaryIds.has(account.id));
      if (!primarySelected.length) throw new Error("Select at least one Facebook or Instagram account.");
      let secondarySelected: ZernioAccount[] = [];
      if (secondaryKey) {
        const secondaryIds = new Set(externalIds(body.secondaryAccountIds));
        const secondaryAvailable = (await listZernioAccounts(secondaryKey)).filter((account) => SECONDARY_PLATFORMS.includes(account.platform.toLowerCase()));
        secondarySelected = secondaryAvailable.filter((account) => secondaryIds.has(account.id));
        if (!secondarySelected.length) throw new Error("Select at least one LinkedIn or Pinterest account.");
      }
      const pinterestBoardId = text(body.pinterestBoardId, 160);
      const pinterestBoardName = text(body.pinterestBoardName, 160);
      if (secondarySelected.some((account) => account.platform.toLowerCase() === "pinterest") && !pinterestBoardId) {
        throw new Error("Choose a default Pinterest board.");
      }
      const { error } = await supabase.from("workspaces").update({
        timezone,
        zernio_api_key_encrypted: suppliedPrimaryKey ? encryptSecret(suppliedPrimaryKey) : workspace.zernio_api_key_encrypted,
        zernio_accounts: primarySelected,
        zernio_secondary_api_key_encrypted: suppliedSecondaryKey ? encryptSecret(suppliedSecondaryKey) : workspace.zernio_secondary_api_key_encrypted,
        zernio_secondary_accounts: secondarySelected,
        pinterest_board_id: pinterestBoardId,
        pinterest_board_name: pinterestBoardName,
      }).eq("id", workspaceId);
      if (error) throw error;
      return NextResponse.json({ primaryAccounts: primarySelected, secondaryAccounts: secondarySelected, timezone });
    }

    if (action === "syncZernio") {
      const workspaceId = id(body.workspaceId, "workspace ID");
      const queueIds = ids(body.queueIds, 250);
      const { data: workspace, error: workspaceError } = await supabase.from("workspaces")
        .select("timezone,zernio_api_key_encrypted,zernio_accounts,zernio_secondary_api_key_encrypted,zernio_secondary_accounts,pinterest_board_id").eq("id", workspaceId).single();
      if (workspaceError) throw workspaceError;
      if (!workspace.zernio_api_key_encrypted && !workspace.zernio_secondary_api_key_encrypted) throw new Error("Connect this workspace to Zernio first.");
      const timezone = workspace.timezone || DEFAULT_TIMEZONE;
      const { data, error } = await supabase.from("schedule_queue").select("*").eq("workspace_id", workspaceId).in("id", queueIds);
      if (error) throw error;
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const item of (data ?? []) as QueueItem[]) {
        const failures: string[] = [];
        const deliveries = [
          workspace.zernio_api_key_encrypted && {
            slot: "primary" as const,
            apiKey: decryptSecret(workspace.zernio_api_key_encrypted),
            accounts: (workspace.zernio_accounts ?? []) as ZernioAccount[],
            allowedPlatforms: PRIMARY_PLATFORMS,
            state: item.sync_state,
            postId: item.zernio_post_id,
            status: item.zernio_status,
            requestId: item.zernio_request_id,
          },
          workspace.zernio_secondary_api_key_encrypted && {
            slot: "secondary" as const,
            apiKey: decryptSecret(workspace.zernio_secondary_api_key_encrypted),
            accounts: (workspace.zernio_secondary_accounts ?? []) as ZernioAccount[],
            allowedPlatforms: SECONDARY_PLATFORMS,
            state: item.secondary_sync_state,
            postId: item.secondary_zernio_post_id,
            status: item.secondary_zernio_status,
            requestId: item.secondary_zernio_request_id,
          },
        ].filter(Boolean) as Array<{ slot: "primary" | "secondary"; apiKey: string; accounts: ZernioAccount[]; allowedPlatforms: string[]; state: string; postId: string | null; status: string | null; requestId: string }>;

        for (const delivery of deliveries) {
          const channel = item.channel.toLowerCase();
          const requestedPlatform = [...PRIMARY_PLATFORMS, ...SECONDARY_PLATFORMS].find((platform) => channel.includes(platform));
          const targets = delivery.accounts.filter((account) => delivery.allowedPlatforms.includes(account.platform.toLowerCase()));
          const applies = requestedPlatform
            ? targets.some((account) => account.platform.toLowerCase() === requestedPlatform)
            : targets.length > 0;
          if (!applies || delivery.state === "synced") continue;
          try {
            if (delivery.status === "published") throw new Error("Published posts cannot be rescheduled.");
            const deliveryItem = { ...item, zernio_post_id: delivery.postId, zernio_request_id: delivery.requestId };
            const result = await syncZernioPost(delivery.apiKey, deliveryItem, delivery.accounts, timezone, {
              allowedPlatforms: delivery.allowedPlatforms,
              pinterestBoardId: workspace.pinterest_board_id,
            }) as { post?: { _id?: string; status?: string }; existingPost?: { _id?: string; status?: string } };
            const post = result.post ?? result.existingPost;
            const postId = post?._id ?? delivery.postId;
            if (!postId) throw new Error("Zernio did not return a post ID.");
            const update = delivery.slot === "primary"
              ? { sync_state: "synced", zernio_post_id: postId, zernio_status: post?.status ?? "scheduled", zernio_last_error: null, sent_to_zernio_at: new Date().toISOString() }
              : { secondary_sync_state: "synced", secondary_zernio_post_id: postId, secondary_zernio_status: post?.status ?? "scheduled", secondary_zernio_last_error: null, secondary_sent_to_zernio_at: new Date().toISOString() };
            const { error: updateError } = await supabase.from("schedule_queue").update(update).eq("id", item.id);
            if (updateError) throw updateError;
          } catch (reason) {
            const message = reason instanceof Error ? reason.message : "Zernio sync failed.";
            const label = delivery.slot === "primary" ? "Facebook / Instagram" : "LinkedIn / Pinterest";
            const update = delivery.slot === "primary"
              ? { sync_state: "error", zernio_last_error: message.slice(0, 1000) }
              : { secondary_sync_state: "error", secondary_zernio_last_error: message.slice(0, 1000) };
            await supabase.from("schedule_queue").update(update).eq("id", item.id);
            failures.push(`${label}: ${message}`);
          }
        }
        results.push({ id: item.id, ok: failures.length === 0, ...(failures.length ? { error: failures.join(" · ") } : {}) });
      }
      return NextResponse.json({ results });
    }

    if (action === "refreshZernio") {
      const workspaceId = id(body.workspaceId, "workspace ID");
      const { data: workspace, error: workspaceError } = await supabase.from("workspaces").select("zernio_api_key_encrypted,zernio_secondary_api_key_encrypted").eq("id", workspaceId).single();
      if (workspaceError) throw workspaceError;
      if (!workspace.zernio_api_key_encrypted && !workspace.zernio_secondary_api_key_encrypted) throw new Error("This workspace is not connected to Zernio.");
      const { data, error } = await supabase.from("schedule_queue").select("id,zernio_post_id,secondary_zernio_post_id").eq("workspace_id", workspaceId);
      if (error) throw error;
      let refreshed = 0;
      for (const item of data ?? []) {
        const checks = [
          item.zernio_post_id && workspace.zernio_api_key_encrypted && { slot: "primary", postId: item.zernio_post_id, apiKey: decryptSecret(workspace.zernio_api_key_encrypted) },
          item.secondary_zernio_post_id && workspace.zernio_secondary_api_key_encrypted && { slot: "secondary", postId: item.secondary_zernio_post_id, apiKey: decryptSecret(workspace.zernio_secondary_api_key_encrypted) },
        ].filter(Boolean) as Array<{ slot: "primary" | "secondary"; postId: string; apiKey: string }>;
        for (const check of checks) {
          try {
            const result = await getZernioPost(check.apiKey, check.postId);
            if (result.post?.status) {
              const update = check.slot === "primary"
                ? { zernio_status: result.post.status, zernio_last_error: null }
                : { secondary_zernio_status: result.post.status, secondary_zernio_last_error: null };
              await supabase.from("schedule_queue").update(update).eq("id", item.id);
              refreshed += 1;
            }
          } catch (reason) {
            const message = reason instanceof Error ? reason.message : "Status check failed.";
            const update = check.slot === "primary"
              ? { zernio_last_error: message.slice(0, 1000) }
              : { secondary_zernio_last_error: message.slice(0, 1000) };
            await supabase.from("schedule_queue").update(update).eq("id", item.id);
          }
        }
      }
      return NextResponse.json({ refreshed });
    }

    if (action === "auditZernioSchedule") {
      const workspaceId = id(body.workspaceId, "workspace ID");
      const { data: workspace, error: workspaceError } = await supabase.from("workspaces")
        .select("name,timezone,zernio_api_key_encrypted,zernio_accounts,zernio_secondary_api_key_encrypted,zernio_secondary_accounts")
        .eq("id", workspaceId).single();
      if (workspaceError) throw workspaceError;
      const now = new Date();
      const { data: queueRows, error: queueError } = await supabase.from("schedule_queue")
        .select("*").eq("workspace_id", workspaceId).not("scheduled_at", "is", null)
        .gte("scheduled_at", now.toISOString()).order("scheduled_at");
      if (queueError) throw queueError;

      const connections = [
        workspace.zernio_api_key_encrypted && {
          slot: "primary" as const,
          label: "Facebook / Instagram",
          apiKey: decryptSecret(workspace.zernio_api_key_encrypted),
          accounts: (workspace.zernio_accounts ?? []) as ZernioAccount[],
          allowedPlatforms: PRIMARY_PLATFORMS,
        },
        workspace.zernio_secondary_api_key_encrypted && {
          slot: "secondary" as const,
          label: "LinkedIn / Pinterest",
          apiKey: decryptSecret(workspace.zernio_secondary_api_key_encrypted),
          accounts: (workspace.zernio_secondary_accounts ?? []) as ZernioAccount[],
          allowedPlatforms: SECONDARY_PLATFORMS,
        },
      ].filter(Boolean) as Array<{
        slot: "primary" | "secondary";
        label: string;
        apiKey: string;
        accounts: ZernioAccount[];
        allowedPlatforms: string[];
      }>;
      const dateFrom = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
      const listed = await Promise.all(connections.map(async (connection) => ({
        connection,
        result: await listZernioPosts(connection.apiKey, dateFrom),
      })));
      const issues: Array<Record<string, unknown>> = [];
      const trackedIds = new Map<string, Array<{ itemId: string; title: string; slot: string }>>();
      const auditedDeliveries: Array<Record<string, unknown>> = [];

      for (const item of (queueRows ?? []) as QueueItem[]) {
        const platform = requestedPlatform(item.channel);
        for (const { connection, result } of listed) {
          const eligibleAccounts = connection.accounts.filter((entry) => connection.allowedPlatforms.includes(entry.platform.toLowerCase()));
          const expectedAccounts = platform
            ? eligibleAccounts.filter((entry) => entry.platform.toLowerCase() === platform)
            : eligibleAccounts;
          if (!expectedAccounts.length) continue;
          const postId = connection.slot === "primary" ? item.zernio_post_id : item.secondary_zernio_post_id;
          const syncState = connection.slot === "primary" ? item.sync_state : item.secondary_sync_state;
          const lastError = connection.slot === "primary" ? item.zernio_last_error : item.secondary_zernio_last_error;
          if (!postId) {
            issues.push({
              kind: "missing_delivery",
              itemId: item.id,
              title: item.title || "(no title)",
              scheduledAt: item.scheduled_at,
              connection: connection.label,
              expectedPlatforms: [...new Set(expectedAccounts.map((entry) => entry.platform.toLowerCase()))],
              syncState,
              error: lastError || undefined,
            });
            continue;
          }
          const tracked = trackedIds.get(postId) ?? [];
          tracked.push({ itemId: item.id, title: item.title || "(no title)", slot: connection.slot });
          trackedIds.set(postId, tracked);
          let post = (result.posts ?? []).find((entry) => entry._id === postId);
          if (!post) post = (await getZernioPost(connection.apiKey, postId)).post;
          if (!post) {
            issues.push({ kind: "missing_zernio_post", itemId: item.id, title: item.title || "(no title)", connection: connection.label, scheduledAt: item.scheduled_at });
            continue;
          }
          const expectedTargets = new Set(expectedAccounts.map((entry) => `${entry.platform.toLowerCase()}:${entry.id}`));
          const actualTargets = new Set((post.platforms ?? []).map((entry) => `${String(entry.platform ?? "").toLowerCase()}:${accountId(entry.accountId)}`));
          const expectedPlatforms = [...new Set(expectedAccounts.map((entry) => entry.platform.toLowerCase()))].sort();
          const actualPlatforms = [...new Set((post.platforms ?? []).map((entry) => String(entry.platform ?? "").toLowerCase()).filter(Boolean))].sort();
          const expectedTime = Date.parse(item.scheduled_at ?? "");
          const actualTime = Date.parse(post.scheduledFor ?? "");
          const scheduleMatches = !Number.isNaN(expectedTime) && !Number.isNaN(actualTime) && Math.abs(expectedTime - actualTime) < 60_000;
          const targetsMatch = expectedTargets.size === actualTargets.size && [...expectedTargets].every((target) => actualTargets.has(target));
          auditedDeliveries.push({
            itemId: item.id,
            title: item.title || "(no title)",
            scheduledAt: item.scheduled_at,
            connection: connection.label,
            status: post.status ?? null,
            platforms: actualPlatforms,
            scheduleMatches,
            targetsMatch,
          });
          if (!scheduleMatches) issues.push({ kind: "schedule_mismatch", itemId: item.id, title: item.title || "(no title)", connection: connection.label, calendarTime: item.scheduled_at, zernioTime: post.scheduledFor ?? null });
          if (!targetsMatch) issues.push({ kind: "platform_mismatch", itemId: item.id, title: item.title || "(no title)", connection: connection.label, expectedPlatforms, actualPlatforms });
          if (["failed", "partial", "cancelled"].includes(String(post.status ?? "").toLowerCase())) {
            issues.push({ kind: "zernio_status", itemId: item.id, title: item.title || "(no title)", connection: connection.label, status: post.status });
          }
        }
      }

      for (const [postId, uses] of trackedIds) {
        if (uses.length > 1) issues.push({ kind: "duplicate_tracked_post_id", postId, uses });
      }

      for (const { connection, result } of listed) {
        const duplicateKeys = new Map<string, Set<string>>();
        for (const post of result.posts ?? []) {
          if (!post._id || !post.scheduledFor) continue;
          const contentKey = postFingerprint(post);
          for (const target of post.platforms ?? []) {
            const key = [String(target.platform ?? "").toLowerCase(), accountId(target.accountId), scheduleFingerprint(post.scheduledFor), contentKey].join("|");
            const posts = duplicateKeys.get(key) ?? new Set<string>();
            posts.add(post._id);
            duplicateKeys.set(key, posts);
          }
        }
        for (const posts of duplicateKeys.values()) {
          if (posts.size > 1) issues.push({ kind: "duplicate_zernio_delivery", connection: connection.label, count: posts.size, postIds: [...posts] });
        }
      }

      return NextResponse.json({
        workspace: workspace.name,
        timezone: workspace.timezone || DEFAULT_TIMEZONE,
        futureCalendarItems: queueRows?.length ?? 0,
        auditedDeliveries,
        issues,
      });
    }

    throw new Error("Unknown action.");
  } catch (reason) {
    return jsonError(reason);
  }
}
