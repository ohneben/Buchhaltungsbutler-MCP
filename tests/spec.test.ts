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
  it("generates exactly 54 tools", () => {
    expect(tools).toHaveLength(54);
  });

  it("gives every tool an MCP-valid name, and names are unique", () => {
    const names = tools.map((t) => t.name);
    // MCP tool names allow [A-Za-z0-9_-]; two batch endpoints keep the
    // spec's camelCase (`receipts_addBatch`, `transactions_addBatch`).
    for (const n of names) expect(n).toMatch(/^[A-Za-z0-9_-]+$/);
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

  it("exposes api_key as an optional override (never required)", () => {
    for (const t of tools) {
      expect(t.inputSchema.required ?? []).not.toContain("api_key");
    }
    const withApiKey = tools.filter((t) => t.inputSchema.properties?.api_key);
    expect(withApiKey.length).toBeGreaterThan(0);
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

  it("marks required params (receipts_get needs list_direction)", () => {
    const t = tools.find((x) => x.name === "receipts_get");
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
