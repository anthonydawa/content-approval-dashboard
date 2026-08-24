# Approve

A social content approval and scheduling app built for Vercel, Supabase, Cloudflare R2, and Zernio.

- Supabase stores workspaces, captions, approvals, comments, and independent queue snapshots.
- Cloudflare R2 stores and delivers uploaded images and videos.
- The calendar supports manual scheduling, drag-and-drop day changes, and cadence-based auto queueing.
- Zernio receives only the dashboard's tracked queue items after the schedule is approved.
- A server-enforced shared login protects the dashboard and all data routes.

## Local setup

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env.local` and add the server-only Supabase, login, encryption, and Cloudflare values.
3. Run `supabase/schema.sql` in the Supabase SQL Editor.
4. Start the app with `pnpm dev`.

The generated shared login is stored locally in `ACCESS-CREDENTIALS.txt`. That file is ignored by Git. Zernio API keys are entered per workspace, encrypted before storage, and never returned to the browser.

## Deploy to Vercel

Import this folder or its Git repository into Vercel. Add all variables from `.env.example` to the Vercel project, then deploy.

## Cloudflare R2 setup

1. Create a Standard R2 bucket named `content-approval-media`.
2. Enable its public `r2.dev` development URL and use that address for `R2_PUBLIC_URL`.
3. Create an R2 API token with Object Read & Write access limited to this bucket.
4. Add this browser CORS rule to the bucket, replacing the origins with your live and local app addresses:

```json
[
  {
    "AllowedOrigins": ["https://approve-content-review.vercel.app", "http://localhost:3000"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Uploads go directly from the browser to R2 through a five-minute signed URL. The R2 secret is used only by the server. Images, GIFs, MP4, WEBM, and MOV files up to 90 MB are accepted; larger videos are compressed before upload.

## Security model

The Supabase publishable key is used only from server route handlers. A separate random application API key is required by both PostgREST's pre-request hook and every RLS policy, so the public Supabase endpoint cannot be queried directly. The login session is an HTTP-only, secure, same-site cookie. Zernio credentials use AES-256-GCM encryption at rest.

Queue deletion never deletes a Zernio post. Sync and status checks operate only on exact Zernio post IDs created and stored by this dashboard, leaving every pre-existing Zernio schedule untouched.
