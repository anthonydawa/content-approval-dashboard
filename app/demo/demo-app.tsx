"use client";

import { useState } from "react";
import Image from "next/image";
import {
  CalendarDays, Check, CheckCircle2, Clock3, CloudUpload, ImagePlus, ListChecks,
  LockKeyhole, MessageCircle, MoreHorizontal, Pencil, Plus, RefreshCw, Settings2,
  Sparkles, Trash2, Upload,
} from "lucide-react";
import { demoContent, demoQueue } from "@/lib/demo-data";

type DemoView = "approval" | "queue" | "calendar";

const statusCopy = {
  approved: "Approved",
  pending: "Awaiting review",
  changes_requested: "Feedback added",
};

const calendarPosts = new Map([
  [1, demoQueue[0]], [3, demoQueue[1]], [5, demoQueue[2]], [8, demoQueue[3]],
]);

export default function DemoApp() {
  const [view, setView] = useState<DemoView>("approval");

  return (
    <main className="demo-app">
      <aside className="demo-sidebar">
        <div className="demo-brand"><span>✓</span> Approve<i>.</i></div>
        <div className="demo-sidebar-label">Demo workspace</div>
        <button className="demo-workspace active" type="button">
          <span>JS</span><strong>Juniper Studio</strong><i />
        </button>
        <button className="demo-muted-action" disabled><Plus size={15} /> New workspace</button>
        <div className="demo-side-note"><Sparkles size={18} /><strong>Read-only preview</strong><p>Explore the approval workflow without changing any real content.</p></div>
        <div className="demo-user"><span>DM</span><div><strong>Demo member</strong><small>Preview access</small></div><MoreHorizontal size={17} /></div>
      </aside>

      <section className="demo-content">
        <header className="demo-topbar">
          <div className="demo-breadcrumb"><span>Workspaces</span><b>/</b><strong>Juniper Studio</strong></div>
          <nav className="demo-tabs" aria-label="Demo sections">
            <button className={view === "approval" ? "active" : ""} onClick={() => setView("approval")}><Check size={14} /> Approval</button>
            <button className={view === "queue" ? "active" : ""} onClick={() => setView("queue")}><ListChecks size={14} /> Queue</button>
            <button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}><CalendarDays size={14} /> Calendar</button>
          </nav>
          <span className="demo-pill"><LockKeyhole size={13} /> Demo mode</span>
        </header>

        <div className="demo-page">
          <div className="demo-banner"><LockKeyhole size={16} /><span><strong>Read-only demonstration</strong> — buttons are shown for preview and cannot make changes.</span></div>
          {view === "approval" && <ApprovalDemo />}
          {view === "queue" && <QueueDemo />}
          {view === "calendar" && <CalendarDemo />}
        </div>
      </section>
    </main>
  );
}

function ApprovalDemo() {
  return <>
    <section className="demo-heading">
      <div><small>CONTENT REVIEW</small><h1>Juniper Studio <em>approval queue</em></h1><p>Review a fictional batch of social content, captions, and feedback.</p></div>
      <div className="demo-actions"><button disabled><Upload size={16} /> Upload folder</button><button disabled className="primary"><ImagePlus size={16} /> Add content</button></div>
    </section>
    <div className="demo-progress"><span>Batch progress</span><strong>2 of 4 approved</strong><i><b style={{ width: "50%" }} /></i></div>
    <div className="demo-card-list">
      {demoContent.map((item) => <article className="demo-approval-card" key={item.id}>
        <Image src={item.media_url} alt="" width={1254} height={1254} />
        <div className="demo-card-copy">
          <div className="demo-card-meta"><span>{item.channel}</span><span className={`status-${item.status}`}>{statusCopy[item.status]}</span></div>
          <h2>{item.title}</h2><p>{item.caption}</p>
          <div className="demo-card-buttons">
            <button disabled><CheckCircle2 size={15} /> {item.status === "approved" ? "Approved" : "Approve"}</button>
            <button disabled><MessageCircle size={15} /> Comment {item.comments.length ? `(${item.comments.length})` : ""}</button>
            <button disabled aria-label="Edit"><Pencil size={14} /></button><button disabled aria-label="Delete"><Trash2 size={14} /></button>
          </div>
        </div>
      </article>)}
    </div>
  </>;
}

function QueueDemo() {
  return <>
    <section className="demo-heading">
      <div><small>SCHEDULING QUEUE</small><h1>Juniper Studio <em>scheduler</em></h1><p>Queued posts retain their content and can be arranged before publishing.</p></div>
      <div className="demo-actions"><button disabled><Settings2 size={16} /> Zernio settings</button><button disabled><RefreshCw size={16} /> Shuffle order</button><button disabled className="primary"><Sparkles size={16} /> Auto queue</button></div>
    </section>
    <div className="demo-queue-list">{demoQueue.map((item) => <article className="demo-queue-card" key={item.id}>
      <Image src={item.media_url} alt="" width={1254} height={1254} />
      <div><span className={`demo-sync ${item.sync_state}`}>{item.sync_state === "synced" ? "Scheduled in Zernio" : "Not sent to Zernio"}</span><h3>{item.title}</h3><p>{item.channel}</p></div>
      <label><span><Clock3 size={13} /> Schedule date</span><input disabled type="datetime-local" value={item.scheduled_at?.slice(0, 16) ?? ""} readOnly /></label>
      <button disabled aria-label="Remove"><Trash2 size={15} /></button>
    </article>)}</div>
  </>;
}

function CalendarDemo() {
  const cells = Array.from({ length: 35 }, (_, index) => index < 2 ? 30 + index : index - 1);
  return <>
    <section className="demo-heading">
      <div><small>CONTENT CALENDAR</small><h1>Juniper Studio <em>calendar</em></h1><p>Scheduled posts are plotted in Central Time with their sync status.</p></div>
      <div className="demo-actions"><button disabled><Settings2 size={16} /> Zernio settings</button><button disabled><RefreshCw size={16} /> Refresh</button><button disabled className="primary"><CloudUpload size={16} /> Approve &amp; send schedule</button></div>
    </section>
    <section className="demo-calendar">
      <header><button disabled>‹</button><h2>September 2026</h2><button disabled>›</button></header>
      <div className="demo-weekdays">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(day => <span key={day}>{day}</span>)}</div>
      <div className="demo-calendar-grid">{cells.map((day, index) => {
        const out = index < 2;
        const post = out ? undefined : calendarPosts.get(day);
        return <div className={out ? "outside" : ""} key={`${day}-${index}`}><time>{day}</time>{post && <article className={post.sync_state === "synced" ? "synced" : "pending"}>
          <Image src={post.media_url} alt="" width={360} height={240} /><strong>9:00 AM</strong><span>{post.title}</span><small>{post.sync_state === "synced" ? "Scheduled in Zernio" : "Not sent to Zernio"}</small><button disabled>{post.sync_state === "synced" ? "Scheduled" : "Send now"}</button>
        </article>}</div>;
      })}</div>
    </section>
  </>;
}
