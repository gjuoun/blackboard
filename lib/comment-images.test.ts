import { describe, expect, test } from "bun:test";
import { acceptImage, IMAGE_ID, IMAGE_MAX_BYTES } from "./comment-images";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("comment images", () => {
  test("images: png magic accepted", () => {
    const r = acceptImage(png);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mime).toBe("image/png");
      expect(IMAGE_ID.test(r.name)).toBe(true);
    }
  });

  test("images: svg rejected", () => {
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    expect(acceptImage(svg).ok).toBe(false);
  });

  test("images: over 5MB rejected", () => {
    const big = new Uint8Array(IMAGE_MAX_BYTES + 1);
    big.set(png, 0);
    expect(acceptImage(big)).toEqual({ ok: false, error: "over 5 MB" });
  });

  test("images: id must be sha256 name", () => {
    expect(IMAGE_ID.test("../../etc/passwd")).toBe(false);
    expect(IMAGE_ID.test("a".repeat(64) + ".svg")).toBe(false);
    expect(IMAGE_ID.test("a".repeat(64) + ".png")).toBe(true);
  });
});
