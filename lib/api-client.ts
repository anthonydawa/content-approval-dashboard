export async function apiRequest<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!response.ok) throw new Error(result.error || "The request failed.");
  return result;
}

export async function loadDashboard<T>(): Promise<T> {
  const response = await fetch("/api/data", { cache: "no-store" });
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("Your session expired.");
  }
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!response.ok) throw new Error(result.error || "Could not load data.");
  return result;
}
