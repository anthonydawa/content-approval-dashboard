import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const COOKIE = "approve_session";

function validToken(token: string | undefined) {
  const secret = process.env.APP_SESSION_SECRET;
  if (!token || !secret) return false;
  const [version, expiresText, supplied] = token.split(".");
  const expires = Number(expiresText);
  if (version !== "v1" || !supplied || expires <= Date.now() / 1000) return false;
  const expected = createHmac("sha256", secret)
    .update(`${version}.${expiresText}`)
    .digest("base64url");
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function secureHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "same-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  return response;
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isPublic = pathname === "/login" || pathname === "/demo" || pathname === "/demo/" || pathname === "/api/auth/login" || pathname.startsWith("/approve/") || pathname.startsWith("/api/public/approval/");
  const authenticated = validToken(request.cookies.get(COOKIE)?.value);
  if (!authenticated && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return secureHeaders(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
    }
    return secureHeaders(NextResponse.redirect(new URL("/login", request.url)));
  }
  if (authenticated && pathname === "/login") {
    return secureHeaders(NextResponse.redirect(new URL("/", request.url)));
  }
  const response = secureHeaders(NextResponse.next());
  if (pathname.startsWith("/approve/") || pathname.startsWith("/api/public/approval/")) {
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
