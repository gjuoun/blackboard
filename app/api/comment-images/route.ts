import { NextResponse, type NextRequest } from "next/server";
import { saveImage } from "@/lib/comment-image-store";
import { getHome } from "@/lib/home";

/** POST raw image bytes. The bytes are sniffed; the Content-Type the client sent is ignored. Returns the stored id. */
export async function POST(req: NextRequest) {
  const bytes = new Uint8Array(await req.arrayBuffer());
  const r = saveImage(getHome(), bytes);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ id: r.id });
}
