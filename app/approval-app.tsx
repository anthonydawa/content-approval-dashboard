"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CirclePlus,
  Clock3,
  ImagePlus,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { demoContent, demoWorkspaces } from "@/lib/demo-data";
import { MAX_MEDIA_BYTES, MEDIA_ACCEPT, uploadToR2 } from "@/lib/media-upload";
import { prepareMediaForUpload } from "@/lib/video-compress";
import { getSupabase } from "@/lib/supabase";
import type {
  Comment,
  ContentItem,
  ReviewStatus,
  Workspace,
} from "@/lib/types";

const statusLabel: Record<ReviewStatus, string> = {
  pending: "Awaiting review",
  approved: "Approved",
  changes_requested: "Feedback added",
};

function formatCommentDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function isVideoFile(file: File) {
  return file.type.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(file.name);
}

function contentInsertRow(content: ContentItem) {
  return {
    id: content.id,
    workspace_id: content.workspace_id,
    title: content.title,
    caption: content.caption,
    media_url: content.media_url,
    media_type: content.media_type,
    channel: content.channel,
    scheduled_for: content.scheduled_for,
    status: content.status,
    position: content.position,
  };
}

export default function ApprovalApp() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(demoWorkspaces);
  const [items, setItems] = useState<ContentItem[]>(demoContent);
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  const [commentOpen, setCommentOpen] = useState<string | null>(null);
  const [replaceItem, setReplaceItem] = useState<ContentItem | null>(null);
  const [editItem, setEditItem] = useState<ContentItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<ContentItem | null>(null);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [addContentOpen, setAddContentOpen] = useState(false);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => Boolean(getSupabase()));
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    Promise.all([
      supabase.from("workspaces").select("*").order("created_at"),
      supabase.from("content_items").select("*, comments(*)").order("position"),
    ]).then(([workspaceResult, contentResult]) => {
      const loadedWorkspaces = (workspaceResult.data ?? []) as Workspace[];
      setWorkspaces(loadedWorkspaces);
      setActiveWorkspace(loadedWorkspaces[0]?.id ?? null);
      setItems((contentResult.data ?? []) as ContentItem[]);
      setLoading(false);
    });
  }, []);

  const active =
    workspaces.find((workspace) => workspace.id === activeWorkspace) ??
    workspaces[0];
  const visibleItems = useMemo(
    () =>
      items
        .filter((item) => item.workspace_id === activeWorkspace)
        .sort((a, b) => a.position - b.position),
    [items, activeWorkspace],
  );
  const approvedCount = visibleItems.filter(
    (item) => item.status === "approved",
  ).length;

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2600);
  }

  async function storeMedia(
    file: File,
    workspaceId: string,
    contentId: string,
  ) {
    const uploadFile = await prepareMediaForUpload(file);
    return uploadToR2(uploadFile, workspaceId, contentId);
  }

  async function updateStatus(id: string, status: ReviewStatus) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, status } : item)),
    );
    const supabase = getSupabase();
    if (supabase)
      await supabase.from("content_items").update({ status }).eq("id", id);
    flash(status === "approved" ? "Content approved" : "Feedback saved");
  }

  async function addComment(item: ContentItem, body: string) {
    const comment: Comment = {
      id: crypto.randomUUID(),
      content_id: item.id,
      author: "Reviewer",
      body,
      created_at: new Date().toISOString(),
    };
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              status: "changes_requested",
              comments: [...entry.comments, comment],
            }
          : entry,
      ),
    );
    const supabase = getSupabase();
    if (supabase) {
      await supabase.from("comments").insert(comment);
      await supabase
        .from("content_items")
        .update({ status: "changes_requested" })
        .eq("id", item.id);
    }
    flash("Comment added");
  }

  async function replaceMedia(item: ContentItem, file: File) {
    const mediaUrl = await storeMedia(file, item.workspace_id, item.id);
    const supabase = getSupabase();
    if (supabase) {
      await supabase
        .from("content_items")
        .update({
          media_url: mediaUrl,
          media_type: file.type.startsWith("video") ? "video" : "image",
          status: "pending",
        })
        .eq("id", item.id);
    }
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              media_url: mediaUrl,
              media_type: file.type.startsWith("video") ? "video" : "image",
              status: "pending",
            }
          : entry,
      ),
    );
    setReplaceItem(null);
    flash("Media replaced and sent for review");
  }

  async function createWorkspace(name: string, color: string) {
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name,
      initials: name
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      color,
    };
    setWorkspaces((current) => [...current, workspace]);
    setActiveWorkspace(workspace.id);
    setNewWorkspaceOpen(false);
    const supabase = getSupabase();
    if (supabase) await supabase.from("workspaces").insert(workspace);
    flash(`${name} workspace created`);
  }

  async function addContent(data: {
    title: string;
    caption: string;
    channel: string;
    file: File | null;
  }) {
    if (!activeWorkspace) {
      flash("Create a workspace before adding content");
      return;
    }
    const id = crypto.randomUUID();
    const mediaUrl = data.file
      ? await storeMedia(data.file, activeWorkspace, id)
      : "";
    const mediaType = data.file && isVideoFile(data.file) ? "video" : "image";
    const supabase = getSupabase();
    const content: ContentItem = {
      id,
      workspace_id: activeWorkspace,
      title: data.title.trim(),
      caption: data.caption.trim(),
      media_url: mediaUrl,
      media_type: mediaType,
      channel: data.channel,
      scheduled_for: "Not scheduled",
      status: "pending",
      position: visibleItems.length + 1,
      comments: [],
    };
    setItems((current) => [...current, content]);
    if (supabase) {
      const { error } = await supabase
        .from("content_items")
        .insert(contentInsertRow(content));
      if (error) throw error;
    }
    setAddContentOpen(false);
    flash("Content added to this batch");
  }

  async function addFolderContent(files: File[]) {
    if (!activeWorkspace) {
      flash("Create a workspace before adding content");
      return;
    }

    const drafts: ContentItem[] = [];
    for (const [index, file] of files.entries()) {
      const id = crypto.randomUUID();
      const mediaUrl = await storeMedia(file, activeWorkspace, id);
      drafts.push({
        id,
        workspace_id: activeWorkspace,
        title: "",
        caption: "",
        media_url: mediaUrl,
        media_type: isVideoFile(file) ? "video" : "image",
        channel: "All platforms",
        scheduled_for: "Not scheduled",
        status: "pending",
        position: visibleItems.length + index + 1,
        comments: [],
      });
    }

    const supabase = getSupabase();
    if (supabase) {
      const { error } = await supabase
        .from("content_items")
        .insert(drafts.map(contentInsertRow));
      if (error) throw error;
    }
    setItems((current) => [...current, ...drafts]);
    setBulkUploadOpen(false);
    flash(`${drafts.length} drafts added to this batch`);
  }

  async function editContent(
    item: ContentItem,
    data: {
      title: string;
      caption: string;
      channel: string;
      file: File | null;
    },
  ) {
    const mediaUrl = data.file
      ? await storeMedia(data.file, item.workspace_id, item.id)
      : item.media_url;
    const mediaType = data.file
      ? isVideoFile(data.file)
        ? "video"
        : "image"
      : item.media_type;
    const updated = {
      ...item,
      title: data.title.trim(),
      caption: data.caption.trim(),
      channel: data.channel,
      media_url: mediaUrl,
      media_type: mediaType,
      status: "pending" as ReviewStatus,
    };
    const supabase = getSupabase();
    if (supabase)
      await supabase
        .from("content_items")
        .update({
          title: updated.title,
          caption: updated.caption,
          channel: updated.channel,
          media_url: mediaUrl,
          media_type: mediaType,
          status: "pending",
        })
        .eq("id", item.id);
    setItems((current) =>
      current.map((entry) => (entry.id === item.id ? updated : entry)),
    );
    setEditItem(null);
    flash("Content updated and sent for review");
  }

  async function deleteContent(item: ContentItem) {
    const supabase = getSupabase();
    if (supabase) {
      const { error } = await supabase
        .from("content_items")
        .delete()
        .eq("id", item.id);
      if (error) throw error;
    }
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    setDeleteItem(null);
    flash("Content deleted");
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <Check size={18} strokeWidth={3} />
          </span>
          <span>
            Approve<span className="brand-dot">.</span>
          </span>
        </div>
        <button
          className="mobile-close"
          onClick={() => setMobileMenu(false)}
          aria-label="Close menu"
        >
          <X size={20} />
        </button>
        <div className="sidebar-label">Workspaces</div>
        <nav className="workspace-list" aria-label="Workspaces">
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              className={`workspace-button ${workspace.id === activeWorkspace ? "active" : ""}`}
              onClick={() => {
                setActiveWorkspace(workspace.id);
                setMobileMenu(false);
              }}
            >
              <span
                className="workspace-avatar"
                style={{ background: workspace.color }}
              >
                {workspace.initials}
              </span>
              <span>{workspace.name}</span>
              {workspace.id === activeWorkspace && (
                <span className="active-dot" />
              )}
            </button>
          ))}
        </nav>
        <button
          className="new-workspace"
          onClick={() => setNewWorkspaceOpen(true)}
        >
          <Plus size={16} /> New workspace
        </button>
        <div className="sidebar-card">
          <Sparkles size={18} />
          <strong>Review made simple</strong>
          <p>Keep every caption, file, and comment in one tidy place.</p>
        </div>
        <div className="sidebar-user">
          <span className="user-avatar">AY</span>
          <span>
            <strong>Anthony</strong>
            <small>Workspace owner</small>
          </span>
          <MoreHorizontal size={18} />
        </div>
      </aside>

      <section className="content-area">
        <header className="topbar">
          <button className="mobile-brand" onClick={() => setMobileMenu(true)}>
            {active?.initials || "—"}
            <ChevronDown size={15} />
          </button>
          <div className="breadcrumb">
            <span>Workspaces</span>
            <span>/</span>
            <strong>{active?.name || "Choose a workspace"}</strong>
          </div>
          <div className="top-actions">
            <button
              className="secondary-button"
              onClick={() => setNewWorkspaceOpen(true)}
            >
              <CirclePlus size={17} /> Workspace
            </button>
            <button
              className="secondary-button bulk-button"
              disabled={!active}
              onClick={() => setBulkUploadOpen(true)}
            >
              <Upload size={17} /> Upload folder
            </button>
            <button
              className="primary-button"
              disabled={!active}
              onClick={() => setAddContentOpen(true)}
            >
              <Plus size={17} /> Add content
            </button>
          </div>
        </header>

        <div className="page-wrap">
          <section className="page-intro">
            <div>
              <div className="eyebrow">CONTENT REVIEW</div>
              <h1>
                {active?.name || "Your workspace"} <span>approval queue</span>
              </h1>
              <p>
                Review the media and caption together. Approve what’s ready or
                leave clear feedback below.
              </p>
            </div>
            <div className="progress-card">
              <div className="progress-copy">
                <span>Batch progress</span>
                <strong>
                  {approvedCount} of {visibleItems.length} approved
                </strong>
              </div>
              <div className="progress-track">
                <span
                  style={{
                    width: `${visibleItems.length ? (approvedCount / visibleItems.length) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          </section>

          <div className="batch-heading">
            <div>
              <h2>August content batch</h2>
              <p>{visibleItems.length} posts ready for review</p>
            </div>
            <span className="live-pill">
              <span /> Live review
            </span>
          </div>

          {loading ? (
            <div className="loading-card">Loading your approval queue…</div>
          ) : !active ? (
            <div className="empty-state">
              <CirclePlus size={28} />
              <h3>Create your first workspace</h3>
              <p>
                Set up a brand or business, then add content whenever it is
                ready.
              </p>
              <button
                className="primary-button"
                onClick={() => setNewWorkspaceOpen(true)}
              >
                Create workspace
              </button>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="empty-state">
              <ImagePlus size={28} />
              <h3>No content in this workspace yet</h3>
              <p>Add the first image or video to start a review batch.</p>
              <button
                className="primary-button"
                onClick={() => setAddContentOpen(true)}
              >
                Add content
              </button>
            </div>
          ) : (
            <div className="content-list">
              {visibleItems.map((item, index) => (
                <ContentCard
                  key={item.id}
                  item={item}
                  index={index + 1}
                  isCommentsOpen={commentOpen === item.id}
                  onToggleComments={() =>
                    setCommentOpen(commentOpen === item.id ? null : item.id)
                  }
                  onApprove={() => updateStatus(item.id, "approved")}
                  onComment={(body) => addComment(item, body)}
                  onReplace={() => setReplaceItem(item)}
                  onEdit={() => setEditItem(item)}
                  onDelete={() => setDeleteItem(item)}
                />
              ))}
            </div>
          )}
          <footer>
            <span>
              Approve<span className="brand-dot">.</span>
            </span>
            <p>One place for clear, confident content decisions.</p>
          </footer>
        </div>
      </section>

      {replaceItem && (
        <ReplaceModal
          item={replaceItem}
          onClose={() => setReplaceItem(null)}
          onReplace={replaceMedia}
        />
      )}
      {editItem && (
        <EditContentModal
          item={editItem}
          onClose={() => setEditItem(null)}
          onSave={editContent}
        />
      )}
      {deleteItem && (
        <DeleteContentModal
          item={deleteItem}
          onClose={() => setDeleteItem(null)}
          onDelete={deleteContent}
        />
      )}
      {newWorkspaceOpen && (
        <WorkspaceModal
          onClose={() => setNewWorkspaceOpen(false)}
          onCreate={createWorkspace}
        />
      )}
      {addContentOpen && (
        <AddContentModal
          onClose={() => setAddContentOpen(false)}
          onCreate={addContent}
        />
      )}
      {bulkUploadOpen && (
        <BulkUploadModal
          onClose={() => setBulkUploadOpen(false)}
          onCreate={addFolderContent}
        />
      )}
      {notice && (
        <div className="toast">
          <CheckCircle2 size={18} />
          {notice}
        </div>
      )}
      {mobileMenu && (
        <button
          className="backdrop nav-backdrop"
          onClick={() => setMobileMenu(false)}
          aria-label="Close menu"
        />
      )}
    </main>
  );
}

function ContentCard({
  item,
  index,
  isCommentsOpen,
  onToggleComments,
  onApprove,
  onComment,
  onReplace,
  onEdit,
  onDelete,
}: {
  item: ContentItem;
  index: number;
  isCommentsOpen: boolean;
  onToggleComments: () => void;
  onApprove: () => void;
  onComment: (body: string) => void;
  onReplace: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [comment, setComment] = useState("");
  const approved = item.status === "approved";
  const displayTitle = item.title === "Untitled content" ? "" : item.title;
  return (
    <article className={`content-card ${approved ? "card-approved" : ""}`}>
      <div className="card-topline">
        <div className="post-number">{String(index).padStart(2, "0")}</div>
        <div className={`status-pill status-${item.status}`}>
          <span />
          {statusLabel[item.status]}
        </div>
      </div>
      <div className="card-grid">
        <div className="media-wrap">
          {item.media_url ? (
            <>
              {item.media_type === "video" ? (
                // Uploaded review videos do not include a separate subtitle file.
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  key={item.media_url}
                  src={item.media_url}
                  controls
                  playsInline
                  preload="metadata"
                />
              ) : (
                <img
                  src={item.media_url}
                  alt={displayTitle || "Uploaded content"}
                />
              )}
              {item.media_type === "video" && (
                <span className="video-label">
                  <Play size={13} fill="currentColor" /> Video
                </span>
              )}
            </>
          ) : (
            <div className="media-placeholder">
              <ImagePlus size={25} />
              <strong>No media yet</strong>
              <span>Add it whenever the asset is ready.</span>
            </div>
          )}
        </div>
        <div className="post-details">
          <div className="meta-row">
            <span>{item.channel}</span>
            <span>
              <Clock3 size={13} /> {item.scheduled_for}
            </span>
          </div>
          {displayTitle && <h3>{displayTitle}</h3>}
          <div className="caption-label">Caption</div>
          <p className="caption">{item.caption}</p>
          <div className="review-actions">
            <button className="replace-button" onClick={onReplace}>
              <ImagePlus size={15} /> Replace media
            </button>
            <button
              className={`approve-button ${approved ? "approved" : ""}`}
              onClick={onApprove}
            >
              <Check size={18} strokeWidth={2.5} />
              {approved ? "Approved" : "Approve"}
            </button>
            <button className="comment-button" onClick={onToggleComments}>
              <MessageCircle size={18} /> Comment{" "}
              {item.comments.length > 0 && <span>{item.comments.length}</span>}
            </button>
            <button className="edit-content-button" onClick={onEdit}>
              <Pencil size={16} /> Edit
            </button>
            <button className="delete-content-button" onClick={onDelete}>
              <Trash2 size={16} /> Delete
            </button>
          </div>
        </div>
      </div>
      {isCommentsOpen && (
        <div className="comments-panel">
          <div className="comments-title">
            <span>Feedback</span>
            <button onClick={onToggleComments} aria-label="Close comments">
              <X size={17} />
            </button>
          </div>
          {item.comments.length > 0 && (
            <div className="comment-history">
              {item.comments.map((entry) => (
                <div className="comment-entry" key={entry.id}>
                  <span className="comment-avatar">
                    {entry.author.slice(0, 1)}
                  </span>
                  <div>
                    <div>
                      <strong>{entry.author}</strong>
                      <time>{formatCommentDate(entry.created_at)}</time>
                    </div>
                    <p>{entry.body}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <form
            className="comment-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!comment.trim()) return;
              onComment(comment.trim());
              setComment("");
            }}
          >
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Share what should change…"
              aria-label="Feedback comment"
            />
            <button type="submit" disabled={!comment.trim()}>
              <Send size={16} /> Send feedback
            </button>
          </form>
        </div>
      )}
    </article>
  );
}

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <button
        className="backdrop"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

function ReplaceModal({
  item,
  onClose,
  onReplace,
}: {
  item: ContentItem;
  onClose: () => void;
  onReplace: (item: ContentItem, file: File) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  return (
    <ModalShell
      title="Replace media"
      subtitle={`Upload a new version for “${item.title}”.`}
      onClose={onClose}
    >
      <div className="modal-body">
        <button className="upload-zone" onClick={() => input.current?.click()}>
          <Upload size={25} />
          <strong>{file ? file.name : "Choose an image or video"}</strong>
          <span>
            Large videos are compressed automatically · images up to 90 MB
          </span>
        </button>
        <input
          ref={input}
          type="file"
          accept={MEDIA_ACCEPT}
          hidden
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            setError(
              selected &&
                !isVideoFile(selected) &&
                selected.size > MAX_MEDIA_BYTES
                ? "Choose an image that is 90 MB or smaller."
                : "",
            );
            setFile(selected);
          }}
        />
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!file || Boolean(error) || saving}
            onClick={async () => {
              if (!file) return;
              setSaving(true);
              setError("");
              try {
                await onReplace(item, file);
              } catch (reason) {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Upload failed. Please try again.",
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Preparing video…" : "Replace media"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function WorkspaceModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, color: string) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#536f62");
  return (
    <ModalShell
      title="Create a workspace"
      subtitle="Keep each brand’s content and feedback separate."
      onClose={onClose}
    >
      <form
        className="modal-body form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onCreate(name.trim(), color);
        }}
      >
        <label>
          Brand or business name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Sunday Studio"
          />
        </label>
        <label>
          Workspace color
          <div className="color-row">
            {["#536f62", "#cb653d", "#6b5b95", "#307a8a", "#b3813f"].map(
              (option) => (
                <button
                  type="button"
                  key={option}
                  onClick={() => setColor(option)}
                  className={color === option ? "chosen" : ""}
                  style={{ background: option }}
                  aria-label={`Choose ${option}`}
                />
              ),
            )}
          </div>
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={!name.trim()}>
            Create workspace
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function EditContentModal({
  item,
  onClose,
  onSave,
}: {
  item: ContentItem;
  onClose: () => void;
  onSave: (
    item: ContentItem,
    data: {
      title: string;
      caption: string;
      channel: string;
      file: File | null;
    },
  ) => Promise<void>;
}) {
  const [title, setTitle] = useState(
    item.title === "Untitled content" ? "" : item.title,
  );
  const [caption, setCaption] = useState(item.caption);
  const [channel, setChannel] = useState(item.channel || "All platforms");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <ModalShell
      title="Edit content"
      subtitle="Update the title, caption, platforms, or asset whenever it is ready."
      onClose={onClose}
    >
      <form
        className="modal-body form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          setError("");
          try {
            await onSave(item, { title, caption, channel, file });
          } catch (reason) {
            setError(
              reason instanceof Error
                ? reason.message
                : "Could not save changes. Please try again.",
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <label>
          Post title <small>(optional)</small>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="A short internal title"
          />
        </label>
        <label>
          Caption <small>(optional)</small>
          <textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Paste the social media caption…"
          />
        </label>
        <label>
          Platforms
          <select
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
          >
            <option>All platforms</option>
            <option>Instagram</option>
            <option>Instagram Reel</option>
            <option>Facebook</option>
            <option>LinkedIn</option>
            <option>TikTok</option>
          </select>
        </label>
        <label className="file-field">
          Replace image or video <small>(optional)</small>
          <input
            type="file"
            accept={MEDIA_ACCEPT}
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setError(
                selected &&
                  !isVideoFile(selected) &&
                  selected.size > MAX_MEDIA_BYTES
                  ? "Choose an image that is 90 MB or smaller."
                  : "",
              );
              setFile(selected);
            }}
          />
          <span>
            {file?.name ||
              (item.media_url ? "Keep current asset" : "Choose image or video")}
            <ArrowUpRight size={15} />
          </span>
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={Boolean(error) || saving}
          >
            {saving ? "Preparing video…" : "Save changes"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function DeleteContentModal({
  item,
  onClose,
  onDelete,
}: {
  item: ContentItem;
  onClose: () => void;
  onDelete: (item: ContentItem) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  return (
    <ModalShell
      title="Delete this post?"
      subtitle="This removes the post and its feedback from this workspace."
      onClose={onClose}
    >
      <div className="modal-body delete-confirm">
        <p>
          <strong>{item.title}</strong> will be permanently removed. This cannot
          be undone.
        </p>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="danger-button"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              setError("");
              try {
                await onDelete(item);
              } catch (reason) {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Could not delete this post. Please try again.",
                );
                setDeleting(false);
              }
            }}
          >
            {deleting ? "Deleting…" : "Yes, delete post"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function AddContentModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: {
    title: string;
    caption: string;
    channel: string;
    file: File | null;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [channel, setChannel] = useState("All platforms");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <ModalShell
      title="Add content"
      subtitle="Start a draft now and fill in the details whenever they are ready."
      onClose={onClose}
    >
      <form
        className="modal-body form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          setError("");
          try {
            await onCreate({ title, caption, channel, file });
          } catch (reason) {
            setError(
              reason instanceof Error
                ? reason.message
                : "Could not add content. Please try again.",
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <label>
          Post title <small>(optional)</small>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="A short internal title"
          />
        </label>
        <label>
          Caption <small>(optional)</small>
          <textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Paste the social media caption…"
          />
        </label>
        <label>
          Platforms
          <select
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
          >
            <option>All platforms</option>
            <option>Instagram</option>
            <option>Instagram Reel</option>
            <option>Facebook</option>
            <option>LinkedIn</option>
            <option>TikTok</option>
          </select>
        </label>
        <label className="file-field">
          Image or video <small>(optional)</small>
          <input
            type="file"
            accept={MEDIA_ACCEPT}
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setError(
                selected &&
                  !isVideoFile(selected) &&
                  selected.size > MAX_MEDIA_BYTES
                  ? "Choose an image that is 90 MB or smaller."
                  : "",
              );
              setFile(selected);
            }}
          />
          <span>
            {file?.name || "Choose image or video"}
            <ArrowUpRight size={15} />
          </span>
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={Boolean(error) || saving}
          >
            {saving ? "Preparing video…" : "Add to batch"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function BulkUploadModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (files: File[]) => Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const selectFolder = () => {
    const element = input.current;
    if (!element) return;
    element.setAttribute("webkitdirectory", "");
    element.setAttribute("directory", "");
    element.click();
  };
  const chooseFolder = (selection: FileList | null) => {
    const chosen = Array.from(selection ?? []).filter(
      (file) =>
        file.type.startsWith("image/") || file.type.startsWith("video/"),
    );
    const oversized = chosen.find(
      (file) => !isVideoFile(file) && file.size > MAX_MEDIA_BYTES,
    );
    setError(
      oversized
        ? `${oversized.name} is larger than 90 MB.`
        : chosen.length
          ? ""
          : "This folder has no images or videos to upload.",
    );
    setFiles(oversized ? [] : chosen);
  };
  return (
    <ModalShell
      title="Upload a folder"
      subtitle="Every image and video will become a blank draft. Add titles and captions later with Edit."
      onClose={onClose}
    >
      <div className="modal-body">
        <button type="button" className="upload-zone" onClick={selectFolder}>
          <Upload size={25} />
          <strong>
            {files.length
              ? `${files.length} files ready to upload`
              : "Choose a folder"}
          </strong>
          <span>Images and videos only · up to 90 MB each</span>
        </button>
        <input
          ref={input}
          type="file"
          accept={MEDIA_ACCEPT}
          hidden
          onChange={(event) => chooseFolder(event.target.files)}
        />
        {files.length > 0 && (
          <p className="bulk-summary">
            Each item will be created as an untitled draft for All platforms.
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!files.length || Boolean(error) || saving}
            onClick={async () => {
              setSaving(true);
              setError("");
              try {
                await onCreate(files);
              } catch (reason) {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Could not upload the folder. Please try again.",
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving
              ? `Uploading ${files.length} files…`
              : `Add ${files.length || ""} drafts`}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
