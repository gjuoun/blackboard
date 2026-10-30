import { NextResponse } from "next/server";
import { getHome } from "@/lib/home";
import { prStatus } from "@/lib/pr-status";

/**
 * The same payload as "blackboard pr <session> --json": front matter, the pinned base, the exact
 * git command, files/totals and open comments. SDKs read this instead of the CLI's text output.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const status = prStatus(getHome(), id);
  if (!status) return NextResponse.json({ error: "unknown session" }, { status: 404 });
  return NextResponse.json(status);
}
