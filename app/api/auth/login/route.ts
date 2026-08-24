import { NextResponse } from "next/server";
import {
  assertSameOrigin,
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifyCredentials,
} from "@/lib/server/session";

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 6;

function clientKey(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const key = clientKey(request);
    const now = Date.now();
    const current = attempts.get(key);
    const record =
      current && current.resetAt > now
        ? current
        : { count: 0, resetAt: now + WINDOW_MS };
    if (record.count >= MAX_ATTEMPTS) {
      return NextResponse.json(
        { error: "Too many attempts. Try again in 15 minutes." },
        { status: 429 },
      );
    }
    const body = (await request.json()) as {
      username?: unknown;
      password?: unknown;
    };
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!verifyCredentials(username, password)) {
      attempts.set(key, { ...record, count: record.count + 1 });
      return NextResponse.json(
        { error: "Incorrect username or password." },
        { status: 401 },
      );
    }
    attempts.delete(key);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(
      SESSION_COOKIE,
      createSessionToken(),
      sessionCookieOptions(),
    );
    return response;
  } catch (reason) {
    if (reason instanceof Response) return reason;
    return NextResponse.json(
      { error: reason instanceof Error ? reason.message : "Login failed." },
      { status: 500 },
    );
  }
}
