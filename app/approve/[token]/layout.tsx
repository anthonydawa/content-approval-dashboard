import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Content approval",
  description: "Review and approve this social media content batch.",
  robots: { index: false, follow: false, noarchive: true },
};

export default function PublicApprovalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
