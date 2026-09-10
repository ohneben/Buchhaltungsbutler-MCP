import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildToolDefs } from "../src/spec.js";
import {
  ABSORBED_PATHS,
  MERGED_PATHS,
  TOOL_NAMES,
  buildAliases,
  legacyToolName,
} from "../src/naming.js";
import { GUIDANCE } from "../src/guidance.js";

const spec = JSON.parse(readFileSync("spec.json", "utf8")) as {
  paths: Record<string, Record<string, { parameters?: { name: string }[] }>>;
};
const specPaths = Object.keys(spec.paths);
const tools = buildToolDefs();
const aliases = buildAliases(specPaths);

describe("TOOL_NAMES", () => {
  it("accounts for every endpoint, as a tool or as an absorbed twin", () => {
    for (const p of specPaths) {
      expect(TOOL_NAMES[p] !== undefined || ABSORBED_PATHS.has(p)).toBe(true);
    }
    expect(Object.keys(TOOL_NAMES)).toHaveLength(46);
    expect(ABSORBED_PATHS.size).toBe(8);
    expect(46 + 8).toBe(specPaths.length);
  });

  it("names nothing that is not an endpoint", () => {
    for (const p of Object.keys(TOOL_NAMES)) expect(specPaths).toContain(p);
  });

  it("uses the fixed verb vocabulary", () => {
    const verbs = [
      "list",
      "get",
      "create",
      "update",
      "delete",
      "upload",
      "assign",
      "unassign",
      "unconfirm",
      "restore",
      "cancel",
    ];
    for (const name of Object.values(TOOL_NAMES)) {
      expect(verbs.some((v) => name.includes(`_${v}`))).toBe(true);
    }
  });

  it("never mixes add and create for the same idea", () => {
    for (const name of Object.values(TOOL_NAMES)) {
      expect(name).not.toMatch(/_add(_|$)/);
      expect(name).not.toMatch(/[A-Z]/);
    }
  });
});

describe("legacy aliases", () => {
  it("covers every tool name released up to 1.1.1", () => {
    for (const p of specPaths) {
      const old = legacyToolName(p);
      const resolved = aliases[old] ?? old;
      expect(
        tools.some((t) => t.name === resolved),
        `legacy name ${old} does not resolve`
      ).toBe(true);
    }
  });

  it("never shadows a current tool with a different one", () => {
    // The dangerous case: an old name that is now a *different* tool's
    // canonical name would silently route an old call to the wrong endpoint.
    for (const [old, current] of Object.entries(aliases)) {
      const canonical = tools.find((t) => t.name === old);
      if (canonical) expect(canonical.name).toBe(current);
    }
  });

  it("stays out of the advertised catalogue", () => {
    const listed = new Set(tools.map((t) => t.name));
    for (const old of Object.keys(aliases)) {
      expect(listed.has(old)).toBe(false);
    }
  });
});

describe("merged batch tools", () => {
  it("carries the routing pair", () => {
    for (const [batchPath, merge] of Object.entries(MERGED_PATHS)) {
      const t = tools.find((x) => x.path === batchPath);
      expect(t, `no tool for ${batchPath}`).toBeDefined();
      expect(t!.singlePath).toBe(merge.singlePath);
      expect(t!.batchParam).toBe(merge.param);
      expect(t!.inputSchema.required).toContain(merge.param);
    }
  });

  it("routes unambiguously: the batch param is never a single-record field", () => {
    // Routing keys off the presence of the batch array, so the single-record
    // endpoint must not accept a parameter of the same name.
    for (const merge of Object.values(MERGED_PATHS)) {
      const op = Object.values(spec.paths[merge.singlePath])[0];
      const names = (op.parameters ?? []).map((p) => p.name);
      expect(names).not.toContain(merge.param);
    }
  });
});

describe("guidance", () => {
  it("gives every tool a reason to be picked", () => {
    for (const t of tools) {
      expect(GUIDANCE[t.path], `no guidance for ${t.name}`).toBeDefined();
      expect(GUIDANCE[t.path].use.length).toBeGreaterThan(20);
    }
  });

  it("documents nothing that is not a tool", () => {
    const paths = new Set(tools.map((t) => t.path));
    for (const p of Object.keys(GUIDANCE)) expect(paths.has(p)).toBe(true);
  });

  it("only cross-references tools that exist", () => {
    const names = new Set(tools.map((t) => t.name));
    for (const [path, g] of Object.entries(GUIDANCE)) {
      const text = [g.use, g.avoid ?? "", g.note ?? ""].join(" ");
      for (const [, ref] of text.matchAll(/`([a-z][a-z0-9_]*)`/g)) {
        // Backticked lower snake_case that looks like a tool name (has a verb
        // separator) must resolve; field names like `list_direction` do not.
        if (!names.has(ref) && /_(list|create|update|delete|get|cancel)$/.test(ref)) {
          throw new Error(`${path} references unknown tool ${ref}`);
        }
      }
    }
  });
});

describe("output schemas", () => {
  it("declares an object envelope for every tool", () => {
    for (const t of tools) {
      expect(t.outputSchema.type).toBe("object");
      expect(t.outputSchema.properties?.success).toBeDefined();
      expect(t.outputSchema.required).toContain("success");
    }
  });

  it("carries no sample enums from the spec's response examples", () => {
    const json = JSON.stringify(tools.map((t) => t.outputSchema));
    expect(json).not.toContain('"enum"');
  });
});
