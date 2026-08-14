# Approve

A simple social content approval app built for Vercel, Supabase, and Cloudflare R2.

- Supabase stores workspaces, captions, approvals, and comments.
- Cloudflare R2 stores and delivers uploaded images and videos.

## Local setup

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env.local` and add your Supabase and Cloudflare R2 values.
3. Run `supabase/schema.sql` in the Supabase SQL Editor.
4. Start the app with `pnpm dev`.

Without Supabase values the app opens in a fully interactive demo mode. Demo changes last only until the page is refreshed.

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

Uploads go directly from the browser to R2 through a five-minute signed URL. The R2 secret is used only by the server. Images, GIFs, MP4, WEBM, and MOV files up to 250 MB are accepted. Until the R2 variables are present, the existing Supabase media bucket is used as a temporary fallback.

The SQL policies are intentionally open for this no-login test. Replace them with authenticated policies before using real client content.
