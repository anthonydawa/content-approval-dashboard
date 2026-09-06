import { loadPublicApproval } from "@/lib/server/public-approval";
import PublicApprovalClient from "./public-approval-client";

export default async function PublicApprovalPage({ params }: PageProps<"/approve/[token]">) {
  const { token } = await params;
  const data = await loadPublicApproval(token);
  if (!data) {
    return (
      <main className="public-review-shell public-review-invalid">
        <div className="public-review-invalid-card">
          <span className="brand-mark">✓</span>
          <h1>This approval link is unavailable</h1>
          <p>It may have been replaced, disabled, or the approval batch may have been deleted.</p>
        </div>
      </main>
    );
  }
  return <PublicApprovalClient initialData={data} token={token} />;
}
