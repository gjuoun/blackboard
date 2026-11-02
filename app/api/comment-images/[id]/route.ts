import { NextResponse, type NextRequest } from "next/server";
import { IMAGE_ID } from "@/lib/comment-images";
import { readImage } from "@/lib/comment-image-store";
import { getHome } from "@/lib/home";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/** GET one stored image. The id must match the sha256 name pattern; anything else is a 404. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!IMAGE_ID.test(id)) return new NextResponse("not found", { status: 404 });
  const bytes = readImage(getHome(), id);
  if (!bytes) return new NextResponse("not found", { status: 404 });
  const ext = id.slice(id.lastIndexOf(".") + 1);
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "content-type": MIME[ext], "x-content-type-options": "nosniff", "cache-control": "public, max-age=31536000, immutable" },
  });
}
