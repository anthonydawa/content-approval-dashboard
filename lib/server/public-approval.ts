import "server-only";

import { createHash } from "node:crypto";
import { getServerSupabase } from "@/lib/server/supabase-admin";
import type { ContentItem, PublicApprovalData } from "@/lib/types";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function approvalTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function approvalBatchForToken(token: string) {
  if (!TOKEN_PATTERN.test(token)) return null;
  const supabase = getServerSupabase();
  const { data: link, error: linkError } = await supabase
    .from("approval_batch_links")
    .select("batch_id")
    .eq("token_hash", approvalTokenHash(token))
    .maybeSingle();
  if (linkError) throw linkError;
  if (!link) return null;

  const { data: batch, error: batchError } = await supabase
    .from("approval_batches")
    .select("id,workspace_id,name,created_at")
    .eq("id", link.batch_id)
    .maybeSingle();
  if (batchError) throw batchError;
  return batch;
}

export async function loadPublicApproval(token: string): Promise<PublicApprovalData | null> {
  const batch = await approvalBatchForToken(token);
  if (!batch) return null;
  const supabase = getServerSupabase();
  const [workspaceResult, contentResult] = await Promise.all([
    supabase.from("workspaces")
      .select("id,name,initials,color")
      .eq("id", batch.workspace_id)
      .maybeSingle(),
    supabase.from("content_items")
      .select("id,workspace_id,approval_batch_id,title,caption,media_url,media_type,channel,scheduled_for,status,position,comments(id,content_id,author,body,created_at)")
      .eq("approval_batch_id", batch.id)
      .order("position"),
  ]);
  if (workspaceResult.error) throw workspaceResult.error;
  if (contentResult.error) throw contentResult.error;
  if (!workspaceResult.data) return null;
  return {
    workspace: workspaceResult.data,
    batch: {
      id: String(batch.id),
      name: String(batch.name),
      created_at: String(batch.created_at),
    },
    content: (contentResult.data ?? []) as ContentItem[],
  };
}

export async function contentBelongsToApprovalBatch(token: string, contentId: string) {
  const batch = await approvalBatchForToken(token);
  if (!batch) return null;
  const supabase = getServerSupabase();
  const { data, error } = await supabase.from("content_items")
    .select("id,workspace_id,approval_batch_id,title,caption,media_url,media_type,channel,scheduled_for,status,position")
    .eq("id", contentId)
    .eq("approval_batch_id", batch.id)
    .maybeSingle();
  if (error) throw error;
  return data ? { batch, content: data } : null;
}
