export type ReviewStatus = "pending" | "approved" | "changes_requested";

export type Workspace = {
  id: string;
  name: string;
  initials: string;
  color: string;
  timezone: string;
  zernio_configured: boolean;
  zernio_accounts: ZernioAccount[];
  zernio_secondary_configured: boolean;
  zernio_secondary_accounts: ZernioAccount[];
  pinterest_board_id: string;
  pinterest_board_name: string;
  auto_queue_cadence: QueueCadence;
};

export type ApprovalBatch = {
  id: string;
  workspace_id: string;
  name: string;
  created_at: string;
  approval_token?: string | null;
};

export type PublicApprovalData = {
  workspace: Pick<Workspace, "id" | "name" | "initials" | "color">;
  batch: Pick<ApprovalBatch, "id" | "name" | "created_at">;
  content: ContentItem[];
};

export type Comment = {
  id: string;
  content_id: string;
  author: string;
  body: string;
  created_at: string;
};

export type ContentItem = {
  id: string;
  workspace_id: string;
  approval_batch_id: string;
  title: string;
  caption: string;
  media_url: string;
  media_type: "image" | "video";
  channel: string;
  scheduled_for: string;
  status: ReviewStatus;
  position: number;
  comments: Comment[];
};

export type ZernioAccount = {
  id: string;
  platform: string;
  username: string;
  display_name: string;
};

export type ZernioBoard = {
  id: string;
  name: string;
};

export type QueueCadence = {
  frequency: "daily" | "weekdays" | "custom";
  weekdays: number[];
  times: string[];
  start_date: string;
};

export type QueueSyncState = "not_sent" | "dirty" | "synced" | "error";

export type QueueItem = {
  id: string;
  workspace_id: string;
  source_content_id: string | null;
  title: string;
  caption: string;
  media_url: string;
  media_type: "image" | "video";
  channel: string;
  scheduled_at: string | null;
  sync_state: QueueSyncState;
  zernio_post_id: string | null;
  zernio_status: string | null;
  zernio_last_error: string | null;
  zernio_request_id: string;
  sent_to_zernio_at: string | null;
  secondary_sync_state: QueueSyncState;
  secondary_zernio_post_id: string | null;
  secondary_zernio_status: string | null;
  secondary_zernio_last_error: string | null;
  secondary_zernio_request_id: string;
  secondary_sent_to_zernio_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DashboardData = {
  workspaces: Workspace[];
  batches: ApprovalBatch[];
  content: ContentItem[];
  queue: QueueItem[];
};
