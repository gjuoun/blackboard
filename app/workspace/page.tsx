import { connection } from "next/server";
import { ReadingWorkspace } from "@/components/ReadingWorkspace";
import { runtime } from "@/lib/effect/runtime";
import { getHome } from "@/lib/home";
import { workspaceDocs } from "@/lib/reading-workspace";

export const metadata = { title: "Reading workspace" };

/** The inbox: every served document with its persisted reading state. */
export default async function ReadingWorkspacePage() {
  await connection();
  const data = await runtime.runPromise(workspaceDocs(getHome()));
  return <ReadingWorkspace initial={data} />;
}
