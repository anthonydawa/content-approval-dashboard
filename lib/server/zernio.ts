import "server-only";

import type { QueueItem, ZernioAccount, ZernioBoard } from "@/lib/types";

const BASE_URL = "https://zernio.com/api/v1";

export type ZernioPost = {
  _id?: string;
  title?: string;
  content?: string;
  status?: string;
  scheduledFor?: string;
  timezone?: string;
  mediaItems?: Array<{ url?: string; type?: string }>;
  platforms?: Array<{
    platform?: string;
    accountId?: string | { _id?: string; id?: string };
    status?: string;
  }>;
};

async function zernioFetch<T>(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    const error = new Error(
      result.error || result.message || `Zernio returned ${response.status}.`,
    ) as Error & { status?: number; payload?: unknown };
    error.status = response.status;
    error.payload = result;
    throw error;
  }
  return result;
}

export async function listZernioAccounts(apiKey: string) {
  const result = await zernioFetch<{ accounts?: Array<Record<string, unknown>> }>(
    apiKey,
    "/accounts",
  );
  return (result.accounts ?? [])
    .filter((account) => account.isActive !== false)
    .map(
      (account): ZernioAccount => ({
        id: String(account._id ?? account.id ?? ""),
        platform: String(account.platform ?? ""),
        username: String(account.username ?? ""),
        display_name: String(account.displayName ?? account.name ?? ""),
      }),
    )
    .filter((account) => account.id && account.platform);
}

export async function listPinterestBoards(apiKey: string, accountId: string) {
  const result = await zernioFetch<{ boards?: Array<Record<string, unknown>> }>(
    apiKey,
    `/accounts/${encodeURIComponent(accountId)}/pinterest-boards`,
  );
  return (result.boards ?? [])
    .map((board): ZernioBoard => ({
      id: String(board.id ?? board._id ?? ""),
      name: String(board.name ?? "Pinterest board"),
    }))
    .filter((board) => board.id);
}

function channelPlatform(channel: string) {
  const value = channel.toLowerCase();
  if (value.includes("instagram")) return "instagram";
  if (value.includes("facebook")) return "facebook";
  if (value.includes("linkedin")) return "linkedin";
  if (value.includes("tiktok")) return "tiktok";
  if (value.includes("youtube")) return "youtube";
  if (value.includes("twitter") || value === "x") return "twitter";
  if (value.includes("threads")) return "threads";
  if (value.includes("pinterest")) return "pinterest";
  return null;
}

function scheduledFor(value: string, timezone: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

type PostOptions = {
  immediate?: boolean;
  allowedPlatforms?: string[];
  pinterestBoardId?: string;
};

function postBody(item: QueueItem, accounts: ZernioAccount[], timezone: string, options: PostOptions = {}) {
  const { immediate = false, allowedPlatforms, pinterestBoardId } = options;
  if (!immediate && !item.scheduled_at) throw new Error("Choose a schedule first.");
  if (!immediate && item.scheduled_at && new Date(item.scheduled_at).getTime() <= Date.now()) {
    throw new Error("The scheduled time must be in the future.");
  }
  const platform = channelPlatform(item.channel);
  const allowed = allowedPlatforms?.map((entry) => entry.toLowerCase());
  const eligible = allowed?.length
    ? accounts.filter((account) => allowed.includes(account.platform.toLowerCase()))
    : accounts;
  const targets = platform
    ? eligible.filter((account) => account.platform.toLowerCase() === platform)
    : eligible;
  if (!targets.length) {
    throw new Error(`No connected Zernio account matches ${item.channel}.`);
  }
  return {
    title: item.title || undefined,
    content: item.caption || undefined,
    mediaItems: item.media_url
      ? [{ url: item.media_url, type: item.media_type }]
      : undefined,
    platforms: targets.map((account) => {
      const isPinterest = account.platform.toLowerCase() === "pinterest";
      if (isPinterest && !item.media_url) throw new Error("Pinterest requires an image or video.");
      if (isPinterest && !pinterestBoardId) throw new Error("Choose a default Pinterest board in Zernio settings.");
      return {
        platform: account.platform,
        accountId: account.id,
        ...(isPinterest ? {
          platformSpecificData: {
            boardId: pinterestBoardId,
            title: (item.title || item.caption.split(/\r?\n/)[0] || "Social media post").slice(0, 100),
          },
        } : {}),
      };
    }),
    ...(immediate ? { publishNow: true } : { scheduledFor: scheduledFor(item.scheduled_at!, timezone), timezone }),
    isDraft: false,
  };
}

async function createZernioPost(apiKey: string, item: QueueItem, accounts: ZernioAccount[], timezone: string, options: PostOptions = {}) {
  try {
    return await zernioFetch<{
      post?: { _id?: string; status?: string };
      existingPost?: { _id?: string; status?: string };
    }>(apiKey, "/posts", {
      method: "POST",
      headers: { "x-request-id": item.zernio_request_id },
      body: JSON.stringify(postBody(item, accounts, timezone, options)),
    });
  } catch (reason) {
    const error = reason as Error & {
      status?: number;
      payload?: { existingPostId?: string };
    };
    if (error.status === 409 && error.payload?.existingPostId) {
      return {
        existingPost: {
          _id: error.payload.existingPostId,
          status: options.immediate ? "published" : "scheduled",
        },
      };
    }
    throw reason;
  }
}

export async function syncZernioPost(
  apiKey: string,
  item: QueueItem,
  accounts: ZernioAccount[],
  timezone: string,
  options: PostOptions = {},
) {
  const body = postBody(item, accounts, timezone, options);
  if (item.zernio_post_id) {
    return zernioFetch<{ post?: { _id?: string; status?: string } }>(
      apiKey,
      `/posts/${encodeURIComponent(item.zernio_post_id)}`,
      { method: "PUT", body: JSON.stringify(body) },
    );
  }
  return createZernioPost(apiKey, item, accounts, timezone, options);
}

export async function publishZernioPost(apiKey: string, item: QueueItem, accounts: ZernioAccount[], timezone: string, options: PostOptions = {}) {
  return createZernioPost(apiKey, item, accounts, timezone, { ...options, immediate: true });
}

export async function getZernioPost(apiKey: string, postId: string) {
  return zernioFetch<{ post?: ZernioPost }>(
    apiKey,
    `/posts/${encodeURIComponent(postId)}`,
  );
}

export async function listZernioPosts(apiKey: string, dateFrom: string) {
  const query = new URLSearchParams({
    page: "1",
    limit: "500",
    source: "zernio",
    dateFrom,
    sortBy: "scheduled-asc",
  });
  return zernioFetch<{
    posts?: ZernioPost[];
    pagination?: { page?: number; limit?: number; total?: number; pages?: number };
  }>(apiKey, `/posts?${query.toString()}`);
}
