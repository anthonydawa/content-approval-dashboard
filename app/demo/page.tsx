import type { Metadata } from "next";
import DemoApp from "./demo-app";

export const metadata: Metadata = {
  title: "Approve Demo — Social content review",
  description: "A read-only demonstration of the Approve social content review and scheduling dashboard.",
};

export default function DemoPage() {
  return <DemoApp />;
}
