import { NextResponse } from "next/server";
import {
  assertSameOrigin,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/server/session";

export async function POST(request: Request) {
  assertSameOrigin(request);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
