/**
 * Prints the full categorized tool catalog. Run with `npm run list-tools`.
 * Does not require credentials.
 */

import { buildToolDefs, specInfo } from "./spec.js";

const info = specInfo();
const tools = buildToolDefs();

console.log(`${info.title} ${info.version} — ${tools.length} MCP tools`);
console.log(`Base URL: ${info.baseUrl}\n`);

let currentCat = "";
for (const t of tools) {
  if (t.category.banner !== currentCat) {
    currentCat = t.category.banner;
    console.log(`\n${currentCat}`);
    console.log("─".repeat(60));
  }
  const req = (t.inputSchema.required as string[] | undefined) ?? [];
  console.log(
    `  ${t.name.padEnd(42)} POST ${t.path}` +
      (req.length ? `\n      required: ${req.join(", ")}` : "")
  );
}

const counts = tools.reduce<Record<string, number>>((acc, t) => {
  acc[t.category.id] = (acc[t.category.id] || 0) + 1;
  return acc;
}, {});
console.log("\nSummary:", JSON.stringify(counts));
