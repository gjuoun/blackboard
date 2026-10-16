import { describe, expect, test } from "bun:test";
import { slugify } from "./slug";

describe("slugify", () => {
  test("turns a topic into a folder name", () => {
    expect(slugify("Search ranking: admin dashboard")).toBe("search-ranking-admin-dashboard");
  });

  test("drops accents and stray punctuation", () => {
    expect(slugify("  Café — résumé!! ")).toBe("cafe-resume");
  });

  test("cannot produce a path or a hidden folder", () => {
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify(".hidden")).toBe("hidden");
  });

  test("caps the length without a trailing dash", () => {
    const s = slugify("word ".repeat(30));
    expect(s!.length).toBeLessThanOrEqual(60);
    expect(s!.endsWith("-")).toBe(false);
  });

  test("returns null when nothing usable is left", () => {
    expect(slugify("!!! ???")).toBeNull();
  });
});
