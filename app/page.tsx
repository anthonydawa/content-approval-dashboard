import ApprovalApp from "./approval-app";
import { redirect } from "next/navigation";
import { hasSession } from "@/lib/server/session";

export default async function Home() {
  if (!(await hasSession())) redirect("/login");
  return <ApprovalApp />;
}
