import { describe, it, expect } from "vitest";
import { buildToolDefs, specInfo } from "../src/spec.js";

const tools = buildToolDefs();

describe("specInfo", () => {
  it("reads the bundled BuchhaltungsButler spec", () => {
    const info = specInfo();
    expect(info.title).toBe("BuchhaltungsButler API");
    expect(info.baseUrl).toMatch(/^https:\/\/.+\/api\/v1$/);
    expect(info.version).toMatch(/^\d+\.\d+/);
  });
});

describe("buildToolDefs", () => {
  it("generates exactly 46 tools", () => {
    // 54 endpoints, eight of which are the single-record half of a batch
    // pair and are exposed through the batch tool instead.
    expect(tools).toHaveLength(46);
  });

  it("gives every tool an MCP-valid name, and names are unique", () => {
    const names = tools.map((t) => t.name);
    // Curated names are lower snake_case throughout, so none of the spec's
    // camelCase (`/receipts/addBatch`) leaks into the MCP surface.
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(new Set(names).size).toBe(names.length);
  });

  it("orders tools read-first, delete-last", () => {
    expect(tools[0].category.id).toBe("read");
    expect(tools[tools.length - 1].category.id).toBe("delete");
  });

  it("prepends each description with the category banner", () => {
    for (const t of tools) {
      expect(t.description.startsWith(t.category.banner)).toBe(true);
    }
  });

  it("builds a closed object input schema for every tool", () => {
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("does not expose api_key at all by default", () => {
    for (const t of tools) {
      expect(t.inputSchema.required ?? []).not.toContain("api_key");
      expect(t.inputSchema.properties?.api_key).toBeUndefined();
    }
  });

  it("exposes api_key as an optional override when explicitly enabled", () => {
    const prev = process.env.BB_ALLOW_API_KEY_OVERRIDE;
    process.env.BB_ALLOW_API_KEY_OVERRIDE = "1";
    try {
      const opted = buildToolDefs();
      for (const t of opted) {
        expect(t.inputSchema.required ?? []).not.toContain("api_key");
      }
      const withApiKey = opted.filter((t) => t.inputSchema.properties?.api_key);
      expect(withApiKey.length).toBeGreaterThan(0);
    } finally {
      if (prev === undefined) delete process.env.BB_ALLOW_API_KEY_OVERRIDE;
      else process.env.BB_ALLOW_API_KEY_OVERRIDE = prev;
    }
  });

  it("fully resolves $ref — none remain in any input schema", () => {
    const json = JSON.stringify(tools.map((t) => t.inputSchema));
    expect(json).not.toContain("$ref");
  });

  it("strips HTML and entities from descriptions", () => {
    for (const t of tools) {
      expect(t.description).not.toMatch(/<[a-z/][^>]*>/i);
      expect(t.description).not.toContain("&ldquo;");
      expect(t.description).not.toContain("&nbsp;");
    }
  });

  it("marks required params (receipts_list needs list_direction)", () => {
    const t = tools.find((x) => x.name === "receipts_list");
    expect(t).toBeDefined();
    expect(t!.inputSchema.required).toContain("list_direction");
  });

  it("resolves batch/array params into item schemas", () => {
    const anyArrayWithItems = tools.some((t) =>
      Object.values(t.inputSchema.properties ?? {}).some(
        (p) => p.type === "array" && p.items
      )
    );
    expect(anyArrayWithItems).toBe(true);
  });
});
