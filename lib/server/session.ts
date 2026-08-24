import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "approve_session";
const SESSION_LENGTH_SECONDS = 60 * 60 * 12;

function secret() {
  const value = process.env.APP_SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("APP_SESSION_SECRET must be at least 32 characters.");
  }
  return value;
}

function signature(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function safelyEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyCredentials(username: string, password: string) {
  const expectedUsername = process.env.APP_USERNAME ?? "reviewer";
  const expectedPassword = process.env.APP_PASSWORD;
  if (!expectedPassword) throw new Error("APP_PASSWORD is not configured.");
  return (
    safelyEqual(username, expectedUsername) &&
    safelyEqual(password, expectedPassword)
  );
}

export function createSessionToken() {
  const expires = Math.floor(Date.now() / 1000) + SESSION_LENGTH_SECONDS;
  const value = `v1.${expires}`;
  return `${value}.${signature(value)}`;
}

export function isValidSessionToken(token: string | undefined) {
  if (!token) return false;
  const [version, expiresText, suppliedSignature] = token.split(".");
  if (version !== "v1" || !expiresText || !suppliedSignature) return false;
  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || expires <= Date.now() / 1000) return false;
  return safelyEqual(signature(`${version}.${expiresText}`), suppliedSignature);
}

export async function hasSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSessionToken(token);
}

export async function requireSession() {
  if (!(await hasSession())) {
    throw new Response("Unauthorized", { status: 401 });
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_LENGTH_SECONDS,
  };
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(request.url).origin;
  if (origin !== expected) throw new Response("Invalid origin", { status: 403 });
}
