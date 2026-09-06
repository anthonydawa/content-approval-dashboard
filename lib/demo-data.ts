import type { ContentItem, QueueItem, Workspace } from "./types";

export const demoWorkspaces: Workspace[] = [{
  id: "demo-juniper",
  name: "Juniper Studio",
  initials: "JS",
  color: "#6e8170",
  timezone: "America/Chicago",
  zernio_configured: true,
  zernio_accounts: [
    { id: "demo-instagram", platform: "instagram", username: "juniperstudio", display_name: "Juniper Studio" },
    { id: "demo-facebook", platform: "facebook", username: "juniperstudio", display_name: "Juniper Studio" },
  ],
  zernio_secondary_configured: true,
  zernio_secondary_accounts: [
    { id: "demo-linkedin", platform: "linkedin", username: "juniper-studio", display_name: "Juniper Studio" },
    { id: "demo-pinterest", platform: "pinterest", username: "juniperstudio", display_name: "Juniper Studio" },
  ],
  pinterest_board_id: "demo-board",
  pinterest_board_name: "Juniper Ideas",
  auto_queue_cadence: { frequency: "custom", weekdays: [2, 4, 6], times: ["09:00"], start_date: "2026-09-01" },
}];

export const demoContent: ContentItem[] = [
  {
    id: "demo-post-1", workspace_id: "demo-juniper", approval_batch_id: "demo-batch-1", title: "A quieter kind of morning",
    caption: "Slow starts create room for better ideas. This week, we’re making space for thoughtful details and a calmer rhythm.\n\n#JuniperStudio #SlowLiving #CreativePractice",
    media_url: "/demo/eucalyptus-vase.png", media_type: "image", channel: "All platforms",
    scheduled_for: "Sep 1, 2026 · 9:00 AM", status: "approved", position: 1,
    comments: [{ id: "demo-comment-1", content_id: "demo-post-1", author: "Maya", body: "Beautiful direction—ready to share.", created_at: "2026-08-29T16:20:00Z" }],
  },
  {
    id: "demo-post-2", workspace_id: "demo-juniper", approval_batch_id: "demo-batch-1", title: "Make room for the work",
    caption: "A clear desk, a warm cup, and one good idea at a time. What helps you settle into focused work?\n\n#JuniperStudio #StudioNotes #MindfulWork",
    media_url: "/demo/linen-notebook.png", media_type: "image", channel: "Instagram",
    scheduled_for: "Sep 3, 2026 · 9:00 AM", status: "pending", position: 2, comments: [],
  },
  {
    id: "demo-post-3", workspace_id: "demo-juniper", approval_batch_id: "demo-batch-1", title: "Follow the open path",
    caption: "A little distance can bring everything back into focus. Save this for the next day you need a reset.\n\n#JuniperStudio #CoastalCalm #WeekendReset",
    media_url: "/demo/coastal-path.png", media_type: "image", channel: "Facebook",
    scheduled_for: "Sep 5, 2026 · 9:00 AM", status: "changes_requested", position: 3,
    comments: [{ id: "demo-comment-2", content_id: "demo-post-3", author: "Client", body: "Could we make the opening line feel warmer?", created_at: "2026-08-30T10:10:00Z" }],
  },
  {
    id: "demo-post-4", workspace_id: "demo-juniper", approval_batch_id: "demo-batch-1", title: "An evening ritual",
    caption: "End the day gently: lower the lights, put the phone away, and let the room grow quiet.\n\n#JuniperStudio #EveningRitual #HomeNotes",
    media_url: "/demo/amber-candle.png", media_type: "image", channel: "All platforms",
    scheduled_for: "Sep 8, 2026 · 9:00 AM", status: "approved", position: 4, comments: [],
  },
];

export const demoQueue: QueueItem[] = demoContent.map((item, index) => ({
  id: `demo-queue-${index + 1}`,
  workspace_id: item.workspace_id,
  source_content_id: item.id,
  title: item.title,
  caption: item.caption,
  media_url: item.media_url,
  media_type: item.media_type,
  channel: item.channel,
  scheduled_at: ["2026-09-01T14:00:00Z", "2026-09-03T14:00:00Z", "2026-09-05T14:00:00Z", "2026-09-08T14:00:00Z"][index],
  sync_state: index === 1 ? "not_sent" : "synced",
  zernio_post_id: index === 1 ? null : `demo-zernio-${index + 1}`,
  zernio_status: index === 1 ? null : "scheduled",
  zernio_last_error: null,
  zernio_request_id: `demo-request-${index + 1}`,
  sent_to_zernio_at: index === 1 ? null : "2026-08-30T12:00:00Z",
  secondary_sync_state: index === 1 ? "not_sent" : "synced",
  secondary_zernio_post_id: index === 1 ? null : `demo-zernio-social-${index + 1}`,
  secondary_zernio_status: index === 1 ? null : "scheduled",
  secondary_zernio_last_error: null,
  secondary_zernio_request_id: `demo-request-social-${index + 1}`,
  secondary_sent_to_zernio_at: index === 1 ? null : "2026-08-30T12:00:00Z",
  created_at: "2026-08-28T12:00:00Z",
  updated_at: "2026-08-30T12:00:00Z",
}));
