const MAX_UPLOAD_BYTES = 90 * 1024 * 1024;

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((value) => value.trim());
  if (!allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(request, env, body, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders(request, env), "Cache-Control": "no-store" },
  });
}

function hexToBytes(value) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g), (part) => Number.parseInt(part, 16));
}

async function verifyUpload(secret, key, expires, signature) {
  const signatureBytes = hexToBytes(signature);
  if (!signatureBytes) return false;
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    cryptoKey,
    signatureBytes,
    encoder.encode(`${key}:${expires}`),
  );
}

async function upload(request, env, url) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((value) => value.trim());
  if (!allowed.includes(origin)) return json(request, env, { error: "Origin not allowed." }, 403);

  const key = decodeURIComponent(url.pathname.slice("/upload/".length));
  const expires = Number(url.searchParams.get("expires"));
  const signature = url.searchParams.get("signature") || "";
  const now = Math.floor(Date.now() / 1000);
  if (!key || !Number.isFinite(expires) || expires < now || expires > now + 600) {
    return json(request, env, { error: "Upload link expired." }, 401);
  }
  if (!(await verifyUpload(env.UPLOAD_SIGNING_SECRET, key, expires, signature))) {
    return json(request, env, { error: "Invalid upload link." }, 401);
  }

  const size = Number(request.headers.get("Content-Length"));
  if (!Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_BYTES || !request.body) {
    return json(request, env, { error: "Files must be 90 MB or smaller." }, 413);
  }

  const object = await env.MEDIA.put(key, request.body, {
    httpMetadata: { contentType: request.headers.get("Content-Type") || "application/octet-stream" },
  });
  if (!object) return json(request, env, { error: "Upload did not complete." }, 500);

  console.log(JSON.stringify({ event: "media_upload", key, size: object.size }));
  return json(request, env, { key: object.key, size: object.size });
}

async function serveMedia(request, env, url) {
  const key = decodeURIComponent(url.pathname.slice("/media/".length));
  // Some social-media validators request a byte range but still require a
  // complete 200 response for images. Keep range support for videos, where
  // seeking is important, and serve images as a normal full response.
  const isImage = /\.(avif|gif|jpe?g|png|webp)$/i.test(key);
  const object = await env.MEDIA.get(key, isImage ? undefined : { range: request.headers });
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: object.httpEtag,
  });
  object.writeHttpMetadata(headers);

  let status = 200;
  if (!isImage && object.range && "offset" in object.range) {
    const end = object.range.offset + object.range.length - 1;
    headers.set("Content-Range", `bytes ${object.range.offset}-${end}/${object.size}`);
    status = 206;
  }
  return new Response(object.body, { status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS" && url.pathname.startsWith("/upload/")) {
        return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      }
      if (request.method === "PUT" && url.pathname.startsWith("/upload/")) {
        return await upload(request, env, url);
      }
      if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/media/")) {
        return await serveMedia(request, env, url);
      }
      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({ ok: true, storage: "cloudflare-r2" });
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error(JSON.stringify({ event: "media_error", message: String(error) }));
      return json(request, env, { error: "Media service error." }, 500);
    }
  },
};
