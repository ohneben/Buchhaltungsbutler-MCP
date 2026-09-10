import { describe, it, expect } from "vitest";
import { buildToolDefs } from "../src/spec.js";
import { applyToolPolicy } from "../src/server.js";

const all = buildToolDefs();

describe("applyToolPolicy", () => {
  it("exposes every tool when no policy is set", () => {
    expect(applyToolPolicy(all, {})).toHaveLength(46);
  });

  it("BB_READ_ONLY keeps exactly the read-only tools", () => {
    const out = applyToolPolicy(all, { BB_READ_ONLY: "true" });
    expect(out).toHaveLength(15);
    expect(out.every((t) => t.category.annotations.readOnlyHint)).toBe(true);
    expect(out.some((t) => t.category.annotations.destructiveHint)).toBe(false);
  });

  it("BB_TOOL_ALLOWLIST restricts to the named tools", () => {
    const out = applyToolPolicy(all, {
      BB_TOOL_ALLOWLIST: " accounts_list, receipts_list ",
    });
    expect(out.map((t) => t.name).sort()).toEqual([
      "accounts_list",
      "receipts_list",
    ]);
  });

  it("an allowlist cannot re-enable a write tool under BB_READ_ONLY", () => {
    const out = applyToolPolicy(all, {
      BB_READ_ONLY: "1",
      BB_TOOL_ALLOWLIST: "accounts_list,postings_cancel",
    });
    expect(out.map((t) => t.name)).toEqual(["accounts_list"]);
  });

  it("ignores unknown or falsy values", () => {
    expect(applyToolPolicy(all, { BB_READ_ONLY: "false" })).toHaveLength(46);
    expect(applyToolPolicy(all, { BB_READ_ONLY: "", BB_TOOL_ALLOWLIST: "" })).toHaveLength(46);
  });
});
