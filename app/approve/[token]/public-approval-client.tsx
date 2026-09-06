"use client";

import { useState } from "react";
import { ArrowUpRight, Check, CheckCircle2, Clock3, ImagePlus, MessageCircle, Pencil, Play, Send, Trash2, Upload, X } from "lucide-react";
import { MAX_MEDIA_BYTES, MEDIA_ACCEPT, uploadToR2 } from "@/lib/media-upload";
import { prepareMediaForUpload } from "@/lib/video-compress";
import type { Comment, ContentItem, PublicApprovalData } from "@/lib/types";

const labels = {
  pending: "Awaiting review",
  approved: "Approved",
  changes_requested: "Feedback added",
};

function isVideoFile(file: File) {
  return file.type.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(file.name);
}

function commentDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export default function PublicApprovalClient({ initialData, token }: { initialData: PublicApprovalData; token: string }) {
  const [data, setData] = useState(initialData);
  const [commentOpen, setCommentOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [replacing, setReplacing] = useState<ContentItem | null>(null);
  const [deleting, setDeleting] = useState<ContentItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function request<T>(action: string, payload: Record<string, unknown>) {
    const response = await fetch(`/api/public/approval/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const result = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(result.error || "The request failed.");
    return result;
  }

  async function refresh() {
    const response = await fetch(`/api/public/approval/${encodeURIComponent(token)}`, { cache: "no-store" });
    const result = (await response.json()) as PublicApprovalData & { error?: string };
    if (!response.ok) throw new Error(result.error || "Could not refresh this approval batch.");
    setData(result);
  }

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2800);
  }

  async function approve(item: ContentItem) {
    try {
      await request("approve", { id: item.id });
      await refresh();
      flash("Content approved");
    } catch (reason) {
      flash(reason instanceof Error ? reason.message : "Could not approve this content.");
    }
  }

  async function comment(item: ContentItem, body: string) {
    await request<{ comment: Comment }>("addComment", { contentId: item.id, body });
    await refresh();
    flash("Feedback sent");
  }

  async function save(item: ContentItem, values: { title: string; caption: string; channel: string; file: File | null }) {
    const prepared = values.file ? await prepareMediaForUpload(values.file) : null;
    const uploadedUrl = prepared
      ? await uploadToR2(prepared, item.workspace_id, item.id, token)
      : item.media_url;
    await request("edit", {
      id: item.id,
      title: values.title,
      caption: values.caption,
      channel: values.channel,
      media_url: uploadedUrl,
      media_type: prepared ? (isVideoFile(prepared) ? "video" : "image") : item.media_type,
    });
    await refresh();
    setEditing(null);
    flash("Content updated");
  }

  async function replace(item: ContentItem, file: File) {
    const prepared = await prepareMediaForUpload(file);
    const uploadedUrl = await uploadToR2(prepared, item.workspace_id, item.id, token);
    await request("edit", {
      id: item.id,
      title: item.title,
      caption: item.caption,
      channel: item.channel,
      media_url: uploadedUrl,
      media_type: isVideoFile(prepared) ? "video" : "image",
    });
    await refresh();
    setReplacing(null);
    flash("Media replaced");
  }

  async function remove(item: ContentItem) {
    await request("delete", { id: item.id });
    setData((current) => ({ ...current, content: current.content.filter((entry) => entry.id !== item.id) }));
    setDeleting(null);
    flash("Content deleted");
  }

  const approved = data.content.filter((item) => item.status === "approved").length;
  return (
    <main className="public-review-shell">
      <header className="public-review-topbar">
        <div className="public-review-brand"><span className="brand-mark"><Check size={18} strokeWidth={3} /></span>Approve<span className="brand-dot">.</span></div>
        <span className="public-review-secure">Dedicated client review</span>
      </header>
      <div className="public-review-wrap">
        <section className="public-review-intro">
          <div>
            <div className="eyebrow">{data.workspace.name.toUpperCase()}</div>
            <h1>{data.batch.name} <span>content review</span></h1>
            <p>Review each post below. You can approve it, leave feedback, edit the details, replace its media, or remove it from this approval batch.</p>
          </div>
          <div className="progress-card">
            <div className="progress-copy"><span>Batch progress</span><strong>{approved} of {data.content.length} approved</strong></div>
            <div className="progress-track"><span style={{ width: `${data.content.length ? approved / data.content.length * 100 : 0}%` }} /></div>
          </div>
        </section>
        <div className="batch-heading public-review-heading">
          <div><h2>{data.batch.name}</h2><p>{data.content.length} posts in this approval batch</p></div>
          <span className="live-pill"><span /> Live review</span>
        </div>
        {data.content.length ? (
          <div className="content-list">
            {data.content.map((item, index) => (
              <ReviewCard
                key={item.id}
                item={item}
                index={index + 1}
                commentsOpen={commentOpen === item.id}
                onToggleComments={() => setCommentOpen(commentOpen === item.id ? null : item.id)}
                onApprove={() => void approve(item)}
                onComment={(body) => comment(item, body)}
                onReplace={() => setReplacing(item)}
                onEdit={() => setEditing(item)}
                onDelete={() => setDeleting(item)}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state"><CheckCircle2 size={28} /><h3>No content is waiting for review</h3><p>This batch is currently empty.</p></div>
        )}
        <footer><span>Approve<span className="brand-dot">.</span></span><p>This link only provides access to {data.batch.name}.</p></footer>
      </div>
      {replacing && <ReplaceDialog item={replacing} onClose={() => setReplacing(null)} onSave={replace} />}
      {editing && <EditDialog item={editing} onClose={() => setEditing(null)} onSave={save} />}
      {deleting && <DeleteDialog item={deleting} onClose={() => setDeleting(null)} onDelete={remove} />}
      {notice && <div className="toast"><CheckCircle2 size={18} />{notice}</div>}
    </main>
  );
}

function ReviewCard({ item, index, commentsOpen, onToggleComments, onApprove, onComment, onReplace, onEdit, onDelete }: {
  item: ContentItem;
  index: number;
  commentsOpen: boolean;
  onToggleComments: () => void;
  onApprove: () => void;
  onComment: (body: string) => Promise<void>;
  onReplace: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const title = item.title === "Untitled content" ? "" : item.title;
  const approved = item.status === "approved";
  return (
    <article className={`content-card ${approved ? "card-approved" : ""}`}>
      <div className="card-topline"><div className="post-number">{String(index).padStart(2, "0")}</div><div className={`status-pill status-${item.status}`}><span />{labels[item.status]}</div></div>
      <div className="card-grid">
        <div className="media-wrap">
          {item.media_url ? item.media_type === "video" ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <><video key={item.media_url} src={item.media_url} controls playsInline preload="metadata" /><span className="video-label"><Play size={13} fill="currentColor" /> Video</span></>
          ) : <img src={item.media_url} alt={title || "Uploaded content"} /> : (
            <div className="media-placeholder"><ImagePlus size={25} /><strong>No media yet</strong><span>The asset can be added with Edit.</span></div>
          )}
        </div>
        <div className="post-details">
          <div className="meta-row"><span>{item.channel}</span><span><Clock3 size={13} /> {item.scheduled_for}</span></div>
          {title && <h3>{title}</h3>}
          <div className="caption-label">Caption</div><p className="caption">{item.caption}</p>
          <div className="review-actions">
            <button className="replace-button" onClick={onReplace}><ImagePlus size={15} /> Replace media</button>
            <button className={`approve-button ${approved ? "approved" : ""}`} onClick={onApprove}><Check size={18} strokeWidth={2.5} />{approved ? "Approved" : "Approve"}</button>
            <button className="comment-button" onClick={onToggleComments}><MessageCircle size={18} /> Comment {item.comments.length > 0 && <span>{item.comments.length}</span>}</button>
            <button className="edit-content-button" onClick={onEdit}><Pencil size={16} /> Edit</button>
            <button className="delete-content-button" onClick={onDelete}><Trash2 size={16} /> Delete</button>
          </div>
        </div>
      </div>
      {commentsOpen && (
        <div className="comments-panel">
          <div className="comments-title"><span>Feedback</span><button onClick={onToggleComments} aria-label="Close comments"><X size={17} /></button></div>
          {item.comments.length > 0 && <div className="comment-history">{item.comments.map((entry) => <div className="comment-entry" key={entry.id}><span className="comment-avatar">{entry.author.slice(0, 1)}</span><div><div><strong>{entry.author}</strong><time>{commentDate(entry.created_at)}</time></div><p>{entry.body}</p></div></div>)}</div>}
          <form className="comment-form" onSubmit={async (event) => { event.preventDefault(); if (!comment.trim()) return; setSending(true); setError(""); try { await onComment(comment.trim()); setComment(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send feedback."); } finally { setSending(false); } }}>
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Share what should change…" aria-label="Feedback comment" />
            <button type="submit" disabled={!comment.trim() || sending}><Send size={16} /> {sending ? "Sending…" : "Send feedback"}</button>
          </form>
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
    </article>
  );
}

function Dialog({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return <><button className="backdrop" onClick={onClose} aria-label="Close dialog" /><div className="modal" role="dialog" aria-modal="true"><div className="modal-head"><div><h2>{title}</h2><p>{subtitle}</p></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></div>{children}</div></>;
}

function ReplaceDialog({ item, onClose, onSave }: { item: ContentItem; onClose: () => void; onSave: (item: ContentItem, file: File) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  return <Dialog title="Replace media" subtitle="Upload a new image or video for this post." onClose={onClose}><div className="modal-body"><label className="upload-zone public-upload-zone"><Upload size={25} /><strong>{file?.name || "Choose an image or video"}</strong><span>Large videos are compressed automatically · up to 90 MB</span><input type="file" accept={MEDIA_ACCEPT} hidden onChange={(event) => { const selected = event.target.files?.[0] ?? null; setFile(selected); setError(selected && !isVideoFile(selected) && selected.size > MAX_MEDIA_BYTES ? "Choose an image that is 90 MB or smaller." : ""); }} /></label>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!file || saving || Boolean(error)} onClick={async () => { if (!file) return; setSaving(true); setError(""); try { await onSave(item, file); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not replace the media."); setSaving(false); } }}>{saving ? "Preparing video…" : "Replace media"}</button></div></div></Dialog>;
}

function EditDialog({ item, onClose, onSave }: { item: ContentItem; onClose: () => void; onSave: (item: ContentItem, values: { title: string; caption: string; channel: string; file: File | null }) => Promise<void> }) {
  const [title, setTitle] = useState(item.title === "Untitled content" ? "" : item.title); const [caption, setCaption] = useState(item.caption); const [channel, setChannel] = useState(item.channel || "All platforms"); const [file, setFile] = useState<File | null>(null); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  return <Dialog title="Edit content" subtitle="Update the title, caption, platforms, or asset." onClose={onClose}><form className="modal-body form-stack" onSubmit={async (event) => { event.preventDefault(); setSaving(true); setError(""); try { await onSave(item, { title, caption, channel, file }); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the changes."); setSaving(false); } }}><label>Post title <small>(optional)</small><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="A short internal title" /></label><label>Caption <small>(optional)</small><textarea value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Social media caption…" /></label><label>Platforms<select value={channel} onChange={(event) => setChannel(event.target.value)}><option>All platforms</option><option>Instagram</option><option>Instagram Reel</option><option>Facebook</option><option>LinkedIn</option><option>Pinterest</option><option>TikTok</option></select></label><label className="file-field">Replace image or video <small>(optional)</small><input type="file" accept={MEDIA_ACCEPT} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><span>{file?.name || (item.media_url ? "Keep current asset" : "Choose image or video")}<ArrowUpRight size={15} /></span></label>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Preparing video…" : "Save changes"}</button></div></form></Dialog>;
}

function DeleteDialog({ item, onClose, onDelete }: { item: ContentItem; onClose: () => void; onDelete: (item: ContentItem) => Promise<void> }) {
  const [deleting, setDeleting] = useState(false); const [error, setError] = useState("");
  return <Dialog title="Delete this post?" subtitle="This removes it from this approval batch." onClose={onClose}><div className="modal-body delete-confirm"><p><strong>{item.title || "This post"}</strong> will be permanently removed from the approval batch. A separate copy already in the scheduling queue will not be removed.</p>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="danger-button" disabled={deleting} onClick={async () => { setDeleting(true); setError(""); try { await onDelete(item); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete this post."); setDeleting(false); } }}>{deleting ? "Deleting…" : "Yes, delete post"}</button></div></div></Dialog>;
}
