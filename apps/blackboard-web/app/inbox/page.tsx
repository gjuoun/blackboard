import { connection } from "next/server";
import { ReadingWorkspace } from "@/components/ReadingWorkspace";
import { apiGetJson } from "@/lib/api-fetch";
import { getHome } from "@/lib/home";
import type { WorkspaceData } from "@/lib/reading-model";

export const metadata = { title: "Inbox" };

/** The inbox: every served document with its persisted reading state. */
export default async function InboxPage() {
  await connection();
  const data = await apiGetJson<WorkspaceData>(getHome(), "/api/workspace");
  return <ReadingWorkspace initial={data} />;
}
