import { describe, it, expect } from "vitest";
import {
  CATEGORIES,
  PATH_CATEGORY,
  categoryForPath,
} from "../src/categories.js";

describe("PATH_CATEGORY", () => {
  it("maps all 54 v1 endpoints", () => {
    expect(Object.keys(PATH_CATEGORY)).toHaveLength(54);
  });

  it("has the documented count per category", () => {
    const counts: Record<string, number> = {};
    for (const id of Object.values(PATH_CATEGORY)) {
      counts[id] = (counts[id] ?? 0) + 1;
    }
    expect(counts).toEqual({
      read: 15,
      create: 24,
      update: 4,
      link: 4,
      revert: 4,
      delete: 3,
    });
  });

  it("only references known category ids", () => {
    for (const id of Object.values(PATH_CATEGORY)) {
      expect(CATEGORIES[id]).toBeDefined();
    }
  });
});

describe("categoryForPath", () => {
  it("returns the read category for a known read path", () => {
    const c = categoryForPath("/accounts/get");
    expect(c.id).toBe("read");
    expect(c.annotations.readOnlyHint).toBe(true);
    expect(c.annotations.destructiveHint).toBe(false);
  });

  it("flags deletes as destructive", () => {
    const c = categoryForPath("/cost-locations/delete");
    expect(c.id).toBe("delete");
    expect(c.annotations.destructiveHint).toBe(true);
    expect(c.annotations.readOnlyHint).toBe(false);
  });

  it("falls back to the conservative create category for unmapped paths", () => {
    const c = categoryForPath("/some/unmapped/path");
    expect(c.id).toBe("create");
    expect(c.annotations.readOnlyHint).toBe(false);
  });
});

describe("CATEGORIES", () => {
  it("marks only read as read-only", () => {
    for (const [id, meta] of Object.entries(CATEGORIES)) {
      expect(meta.annotations.readOnlyHint).toBe(id === "read");
    }
  });

  it("marks only delete as destructive", () => {
    for (const [id, meta] of Object.entries(CATEGORIES)) {
      expect(meta.annotations.destructiveHint).toBe(id === "delete");
    }
  });

  it("gives every category a non-empty banner and blurb", () => {
    for (const meta of Object.values(CATEGORIES)) {
      expect(meta.banner.length).toBeGreaterThan(0);
      expect(meta.blurb.length).toBeGreaterThan(0);
    }
  });
});
