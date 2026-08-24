"use client";

import { useMemo, useState } from "react";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CloudUpload,
  RefreshCw,
  Settings2,
  Sparkles,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import type { QueueCadence, QueueItem, Workspace, ZernioAccount } from "@/lib/types";

type Props = {
  mode: "queue" | "calendar";
  workspace: Workspace;
  queue: QueueItem[];
  onChanged: () => Promise<void>;
  flash: (message: string) => void;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_TIMEZONE = "America/Chicago";

function localInputValue(value: string | null, timezone = DEFAULT_TIMEZONE) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function workspaceDateTimeToIso(value: string, timezone: string) {
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wallClock;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const displayed = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    guess = wallClock - (displayed - guess);
  }
  return new Date(guess).toISOString();
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateKeyUtc(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function calendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function syncLabel(item: QueueItem) {
  if (item.zernio_status === "published") return "Published";
  if (item.sync_state === "synced") return "Scheduled in Zernio";
  if (item.sync_state === "dirty") return "Changed · resend";
  if (item.sync_state === "error") return "Zernio error";
  return "Not sent to Zernio";
}

function queueTitle(item: QueueItem) {
  return item.title || item.caption.slice(0, 54) || "Media post";
}

export default function SchedulerView({ mode, workspace, queue, onChanged, flash }: Props) {
  const [autoOpen, setAutoOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<QueueItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [queueOrder, setQueueOrder] = useState<string[]>([]);
  const [queueOrderWorkspace, setQueueOrderWorkspace] = useState("");
  const persistedOrder = useMemo(() => {
    if (queueOrderWorkspace === workspace.id && queueOrder.length) return queueOrder;
    try {
      const saved = JSON.parse(window.localStorage.getItem(`approval-queue-order:${workspace.id}`) || "[]");
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  }, [queueOrder, queueOrderWorkspace, workspace.id]);
  const orderedQueue = useMemo(() => {
    const byId = new Map(queue.map((item) => [item.id, item]));
    const saved = persistedOrder.map((id) => byId.get(id)).filter((item): item is QueueItem => Boolean(item));
    const remaining = queue.filter((item) => !persistedOrder.includes(item.id));
    const inOrder = [...saved, ...remaining];
    const scheduled = inOrder.filter((item) => item.scheduled_at).sort((left, right) =>
      new Date(left.scheduled_at!).getTime() - new Date(right.scheduled_at!).getTime(),
    );
    const unscheduled = inOrder.filter((item) => !item.scheduled_at);
    return [...scheduled, ...unscheduled];
  }, [persistedOrder, queue]);

  async function saveSchedule(item: QueueItem, value: string) {
    if (!value) return;
    await apiRequest("updateQueueSchedule", { id: item.id, scheduledAt: workspaceDateTimeToIso(value, workspace.timezone || DEFAULT_TIMEZONE) });
    await onChanged();
    flash(item.zernio_post_id ? "Schedule changed — resend it to Zernio when ready" : "Schedule saved");
  }

  async function syncAll() {
    const candidates = queue.filter((item) => item.scheduled_at && item.sync_state !== "synced" && item.zernio_status !== "published");
    if (!candidates.length) return flash("Everything is already synced");
    setBusy(true);
    try {
      const result = await apiRequest<{ results: Array<{ ok: boolean }> }>("syncZernio", {
        workspaceId: workspace.id,
        queueIds: candidates.map((item) => item.id),
      });
      await onChanged();
      const succeeded = result.results.filter((entry) => entry.ok).length;
      flash(`${succeeded} of ${result.results.length} posts sent to Zernio`);
    } finally {
      setBusy(false);
    }
  }

  async function refreshStatuses() {
    setBusy(true);
    try {
      const result = await apiRequest<{ refreshed: number }>("refreshZernio", { workspaceId: workspace.id });
      await onChanged();
      flash(`${result.refreshed} Zernio statuses refreshed`);
    } finally {
      setBusy(false);
    }
  }

  async function shuffleQueue() {
    setBusy(true);
    try {
      const shuffled = [...orderedQueue];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
      }
      const nextOrder = shuffled.map((item) => item.id);
      window.localStorage.setItem(`approval-queue-order:${workspace.id}`, JSON.stringify(nextOrder));
      setQueueOrderWorkspace(workspace.id);
      setQueueOrder(nextOrder);
      await onChanged();
      flash(`${shuffled.length} queued posts shuffled`);
    } catch (reason) {
      flash(reason instanceof Error ? reason.message : "Could not shuffle the queue.");
    } finally {
      setBusy(false);
    }
  }

  async function clearUnsentQueue() {
    const unsentCount = queue.filter((item) => !item.scheduled_at && !item.zernio_post_id).length;
    if (!unsentCount) return flash("There are no unplanned queue items to clear");
    if (!window.confirm(`Remove ${unsentCount} unplanned queue item${unsentCount === 1 ? "" : "s"}? Calendar-plotted and Zernio items will stay.`)) return;
    setBusy(true);
    try {
      const result = await apiRequest<{ removed: number; kept: number }>("clearUnsentQueue", { workspaceId: workspace.id });
      await onChanged();
      flash(`${result.removed} unsent item${result.removed === 1 ? "" : "s"} cleared · ${result.kept} Zernio item${result.kept === 1 ? "" : "s"} kept`);
    } catch (reason) {
      flash(reason instanceof Error ? reason.message : "Could not clear unsent items.");
    } finally {
      setBusy(false);
    }
  }

  async function publishNow(item: QueueItem) {
    if (item.zernio_status === "published" || item.zernio_post_id) return;
    if (!window.confirm(`Send “${queueTitle(item)}” to Zernio now?`)) return;
    setBusy(true);
    try {
      await apiRequest("publishNow", { workspaceId: workspace.id, id: item.id });
      await onChanged();
      flash("Published now — it will not be sent again with the scheduled batch");
    } catch (reason) {
      flash(reason instanceof Error ? reason.message : "Could not publish this post now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="scheduler-head">
        <div>
          <div className="eyebrow">{mode === "queue" ? "SCHEDULING QUEUE" : "CONTENT CALENDAR"}</div>
          <h1>{workspace.name} <span>{mode === "queue" ? "scheduler" : "calendar"}</span></h1>
          <p>
            {mode === "queue"
              ? "Queued posts are independent snapshots and remain here even if their approval copy is deleted."
              : `Drag a post to another day to keep its time. Times use ${workspace.timezone}.`}
          </p>
        </div>
        <div className="scheduler-toolbar">
          <button className="secondary-button" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={16} /> Zernio settings
          </button>
          {mode === "queue" ? (
            <>
              <button className="secondary-button" disabled={busy || queue.length < 2} onClick={shuffleQueue}>
                <Shuffle size={16} /> Shuffle order
              </button>
              <button className="secondary-button" disabled={busy || !queue.some((item) => !item.scheduled_at && !item.zernio_post_id)} onClick={clearUnsentQueue}>
                <Trash2 size={16} /> Clear unsent
              </button>
              <button className="primary-button" disabled={!orderedQueue.length || busy} onClick={() => setAutoOpen(true)}>
                <Sparkles size={16} /> Auto queue
              </button>
            </>
          ) : (
            <>
              <button className="secondary-button" disabled={busy || !workspace.zernio_configured} onClick={refreshStatuses}>
                <RefreshCw size={16} /> Refresh
              </button>
              <button className="secondary-button" disabled={busy || !queue.some((item) => !item.scheduled_at && !item.zernio_post_id)} onClick={clearUnsentQueue}>
                <Trash2 size={16} /> Clear unsent
              </button>
              <button className="primary-button" disabled={busy || !queue.some((item) => item.scheduled_at)} onClick={syncAll}>
                <CloudUpload size={16} /> {busy ? "Sending…" : "Approve & send schedule"}
              </button>
            </>
          )}
        </div>
      </section>

      {!queue.length ? (
        <div className="empty-state scheduler-empty">
          <CalendarClock size={30} />
          <h3>The queue is empty</h3>
          <p>Select posts in Approval and move them into this scheduling queue.</p>
        </div>
      ) : mode === "queue" ? (
        <QueueList queue={orderedQueue} timezone={workspace.timezone || DEFAULT_TIMEZONE} onSave={saveSchedule} onDelete={setDeleteItem} />
      ) : (
        <CalendarGrid monthItems={orderedQueue} timezone={workspace.timezone || DEFAULT_TIMEZONE} busy={busy} onMove={saveSchedule} onPublishNow={publishNow} />
      )}

      {autoOpen && (
        <AutoQueueModal workspace={workspace} queue={orderedQueue} onClose={() => setAutoOpen(false)} onChanged={onChanged} flash={flash} />
      )}
      {settingsOpen && (
        <ZernioSettingsModal workspace={workspace} onClose={() => setSettingsOpen(false)} onChanged={onChanged} flash={flash} />
      )}
      {deleteItem && (
        <ConfirmQueueDelete
          item={deleteItem}
          onClose={() => setDeleteItem(null)}
          onDelete={async () => {
            await apiRequest("deleteQueue", { id: deleteItem.id });
            setDeleteItem(null);
            await onChanged();
            flash("Removed from this queue");
          }}
        />
      )}
    </>
  );
}

function QueueList({ queue, timezone, onSave, onDelete }: {
  queue: QueueItem[];
  timezone: string;
  onSave: (item: QueueItem, value: string) => Promise<void>;
  onDelete: (item: QueueItem) => void;
}) {
  return (
    <div className="queue-list">
      {queue.map((item) => (
        <article className="queue-card" key={item.id}>
          <div className="queue-thumb">
            {item.media_url ? (
              item.media_type === "video" ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={item.media_url} preload="metadata" />
              ) : (
                <img src={item.media_url} alt="" />
              )
            ) : <CalendarClock size={22} />}
          </div>
          <div className="queue-copy">
            <span className={`calendar-status sync-${item.sync_state}`}>{syncLabel(item)}</span>
            <h3>{queueTitle(item)}</h3>
            <p>{item.channel}</p>
            {item.zernio_last_error && <small className="queue-error">{item.zernio_last_error}</small>}
          </div>
          <label className="schedule-field">
            <span><Clock3 size={14} /> Date and time</span>
            <input
              type="datetime-local"
              defaultValue={localInputValue(item.scheduled_at, timezone)}
              onBlur={(event) => {
                if (event.target.value && event.target.value !== localInputValue(item.scheduled_at, timezone)) void onSave(item, event.target.value);
              }}
            />
          </label>
          <button className="queue-delete" onClick={() => onDelete(item)} aria-label="Remove from queue">
            <Trash2 size={16} />
          </button>
        </article>
      ))}
    </div>
  );
}

function CalendarGrid({ monthItems, timezone, busy, onMove, onPublishNow }: {
  monthItems: QueueItem[];
  timezone: string;
  busy: boolean;
  onMove: (item: QueueItem, value: string) => Promise<void>;
  onPublishNow: (item: QueueItem) => Promise<void>;
}) {
  const firstScheduled = monthItems.find((item) => item.scheduled_at)?.scheduled_at;
  const [month, setMonth] = useState(() => {
    const date = firstScheduled ? new Date(firstScheduled) : new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const days = calendarDays(month);
  const byDay = useMemo(() => {
    const map = new Map<string, QueueItem[]>();
    for (const item of monthItems) {
      if (!item.scheduled_at) continue;
      const key = localInputValue(item.scheduled_at, timezone).slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [monthItems, timezone]);

  async function dropOn(itemId: string, day: Date) {
    const item = monthItems.find((entry) => entry.id === itemId);
    if (!item?.scheduled_at) return;
    const current = localInputValue(item.scheduled_at, timezone);
    const moved = `${dateKey(day)}T${current.slice(11, 16)}`;
    await onMove(item, moved);
  }

  return (
    <section className="calendar-shell">
      <div className="calendar-nav">
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft size={18} /></button>
        <h2>{month.toLocaleDateString("en", { month: "long", year: "numeric" })}</h2>
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight size={18} /></button>
      </div>
      <div className="calendar-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">
        {days.map((day) => {
          const key = dateKey(day);
          const out = day.getMonth() !== month.getMonth();
          return (
            <div
              className={`calendar-day ${out ? "calendar-day-out" : ""}`}
              key={key}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void dropOn(event.dataTransfer.getData("text/queue-id"), day)}
            >
              <time>{day.getDate()}</time>
              <div className="calendar-posts">
                {(byDay.get(key) ?? []).map((item) => (
                  <article
                    draggable
                    key={item.id}
                    className={`calendar-post sync-${item.sync_state}`}
                    onDragStart={(event) => event.dataTransfer.setData("text/queue-id", item.id)}
                    title={`${queueTitle(item)} · ${syncLabel(item)}`}
                  >
                    <strong>{new Date(item.scheduled_at!).toLocaleTimeString("en", { timeZone: timezone, hour: "numeric", minute: "2-digit" })}</strong>
                    <span>{queueTitle(item)}</span>
                    <small>{syncLabel(item)}</small>
                    {item.zernio_status !== "published" && !item.zernio_post_id && (
                      <button
                        type="button"
                        className="calendar-send-now"
                        disabled={busy}
                        onClick={(event) => { event.stopPropagation(); void onPublishNow(item); }}
                      >
                        Send now
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {monthItems.some((item) => !item.scheduled_at) && (
        <p className="calendar-note">{monthItems.filter((item) => !item.scheduled_at).length} queued posts still need a date.</p>
      )}
    </section>
  );
}

function ModalShell({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return <><button className="backdrop" onClick={onClose} aria-label="Close dialog" /><div className="modal scheduler-modal" role="dialog" aria-modal="true"><div className="modal-head"><div><h2>{title}</h2><p>{subtitle}</p></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></div>{children}</div></>;
}

function AutoQueueModal({ workspace, queue, onClose, onChanged, flash }: {
  workspace: Workspace; queue: QueueItem[]; onClose: () => void; onChanged: () => Promise<void>; flash: (message: string) => void;
}) {
  const initial = workspace.auto_queue_cadence;
  const [frequency, setFrequency] = useState<QueueCadence["frequency"]>(initial.frequency);
  const [weekdays, setWeekdays] = useState(initial.weekdays);
  const [times, setTimes] = useState(initial.times.join(", "));
  const [startDate, setStartDate] = useState(initial.start_date || dateKey(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const unscheduled = queue.filter((item) => !item.scheduled_at);

  function makeAssignments() {
    const parsedTimes = [...new Set(times.split(",").map((value) => value.trim()).filter((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)))].sort();
    if (!parsedTimes.length) throw new Error("Enter at least one time like 09:00.");
    const allowed = frequency === "daily" ? [0,1,2,3,4,5,6] : frequency === "weekdays" ? [1,2,3,4,5] : weekdays;
    if (!allowed.length) throw new Error("Choose at least one posting day.");
    const timezone = workspace.timezone || DEFAULT_TIMEZONE;
    const occupied = new Set(queue.filter((item) => item.scheduled_at).map((item) => localInputValue(item.scheduled_at, timezone).slice(0, 16)));
    const assignments: Array<{ id: string; scheduledAt: string }> = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);
    let guard = 0;
    while (assignments.length < unscheduled.length && guard < 3700) {
      if (allowed.includes(cursor.getUTCDay())) {
        for (const time of parsedTimes) {
          const candidate = `${dateKeyUtc(cursor)}T${time}`;
          const candidateIso = workspaceDateTimeToIso(candidate, timezone);
          if (new Date(candidateIso).getTime() > Date.now() && !occupied.has(candidate)) {
            assignments.push({ id: unscheduled[assignments.length].id, scheduledAt: candidateIso });
            occupied.add(candidate);
            if (assignments.length === unscheduled.length) break;
          }
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      guard += 1;
    }
    return { assignments, cadence: { frequency, weekdays, times: parsedTimes, start_date: startDate } satisfies QueueCadence };
  }

  return <ModalShell title="Auto queue" subtitle="Append every unscheduled post into the next open cadence slots." onClose={onClose}>
    <form className="modal-body form-stack" onSubmit={async (event) => {
      event.preventDefault(); setSaving(true); setError("");
      try {
        if (!unscheduled.length) throw new Error("Every queued post already has a date.");
        const generated = makeAssignments();
        await apiRequest("autoSchedule", { workspaceId: workspace.id, ...generated });
        await onChanged(); onClose(); flash(`${generated.assignments.length} posts added to the calendar`);
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not auto queue."); }
      finally { setSaving(false); }
    }}>
      <label>Cadence<select value={frequency} onChange={(event) => setFrequency(event.target.value as QueueCadence["frequency"])}><option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="custom">Custom days</option></select></label>
      {frequency === "custom" && <div className="weekday-picker">{WEEKDAYS.map((day, index) => <button type="button" key={day} className={weekdays.includes(index) ? "chosen" : ""} onClick={() => setWeekdays((current) => current.includes(index) ? current.filter((entry) => entry !== index) : [...current, index])}>{day}</button>)}</div>}
      <label>Posting times <small>(comma-separated, 24-hour)</small><input value={times} onChange={(event) => setTimes(event.target.value)} placeholder="09:00, 14:30" /></label>
      <label>Start on<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <p className="modal-hint">{unscheduled.length} unscheduled posts will fill open slots without moving anything already scheduled.</p>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Plotting…" : `Plot ${unscheduled.length} posts`}</button></div>
    </form>
  </ModalShell>;
}

function ZernioSettingsModal({ workspace, onClose, onChanged, flash }: {
  workspace: Workspace; onClose: () => void; onChanged: () => Promise<void>; flash: (message: string) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [timezone, setTimezone] = useState(workspace.timezone || DEFAULT_TIMEZONE);
  const [accounts, setAccounts] = useState<ZernioAccount[]>(workspace.zernio_accounts);
  const [selected, setSelected] = useState(workspace.zernio_accounts.map((account) => account.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setBusy(true); setError("");
    try {
      const result = await apiRequest<{ accounts: ZernioAccount[] }>("loadZernioAccounts", { workspaceId: workspace.id, apiKey });
      setAccounts(result.accounts);
      setSelected(result.accounts.map((account) => account.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load accounts."); }
    finally { setBusy(false); }
  }
  return <ModalShell title="Zernio settings" subtitle="This key and account selection belong only to this workspace." onClose={onClose}>
    <form className="modal-body form-stack" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError("");
      try {
        await apiRequest("saveZernioConfig", { workspaceId: workspace.id, apiKey, timezone, accountIds: selected });
        await onChanged(); onClose(); flash("Zernio connection saved securely");
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save Zernio settings."); }
      finally { setBusy(false); }
    }}>
      <label>Zernio API key <small>{workspace.zernio_configured ? "Leave blank to keep the stored key" : "Required"}</small><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={workspace.zernio_configured ? "Stored securely" : "sk_…"} /></label>
      <label>Workspace timezone<input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Chicago" /></label>
      <button type="button" className="secondary-button load-accounts" disabled={busy || (!apiKey && !workspace.zernio_configured)} onClick={load}>{busy ? "Checking…" : "Load connected accounts"}</button>
      {accounts.length > 0 && <div className="account-picker">{accounts.map((account) => <label key={account.id}><input type="checkbox" aria-label={`Use ${account.display_name || account.username || account.platform}`} checked={selected.includes(account.id)} onChange={() => setSelected((current) => current.includes(account.id) ? current.filter((id) => id !== account.id) : [...current, account.id])} /><span><strong>{account.display_name || account.username || account.platform}</strong><small>{account.platform}{account.username ? ` · ${account.username}` : ""}</small></span></label>)}</div>}
      <p className="modal-hint">Only posts created by this dashboard are tracked or updated. Existing Zernio calendar posts are never modified.</p>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !selected.length}>{busy ? "Saving…" : "Save connection"}</button></div>
    </form>
  </ModalShell>;
}

function ConfirmQueueDelete({ item, onClose, onDelete }: { item: QueueItem; onClose: () => void; onDelete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <ModalShell title="Remove from queue?" subtitle="The approval copy will not be affected." onClose={onClose}><div className="modal-body delete-confirm"><p><strong>{queueTitle(item)}</strong> will be removed from this scheduler. {item.zernio_post_id && "Its existing Zernio post will stay untouched."}</p><div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="danger-button" disabled={busy} onClick={async () => { setBusy(true); await onDelete(); }}>{busy ? "Removing…" : "Yes, remove from queue"}</button></div></div></ModalShell>;
}
