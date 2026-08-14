export type ReviewStatus = "pending" | "approved" | "changes_requested";

export type Workspace = {
  id: string;
  name: string;
  initials: string;
  color: string;
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

