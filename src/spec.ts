/**
 * Loads the bundled BuchhaltungsButler OpenAPI (Swagger 2.0) spec and turns
 * each path into a fully-formed MCP tool definition: a snake_case name, a
 * JSON-Schema input, the category banner, and MCP annotations.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { categoryForPath, type CategoryMeta } from "./categories.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// spec.json sits at the project root (one level above dist/ at runtime,
// and is copied next to the compiled output in the Docker image).
const SPEC_PATH =
  process.env.BB_SPEC_PATH || join(__dirname, "..", "spec.json");

interface SwaggerParam {
  name: string;
  in: string;
  required?: boolean;
  type?: string;
  format?: string;
  description?: string;
  enum?: unknown[];
  items?: JsonSchema;
  schema?: JsonSchema;
}

interface SwaggerOperation {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: SwaggerParam[];
}

interface SwaggerSpec {
  info: { title: string; version: string };
  basePath: string;
  paths: Record<string, Record<string, SwaggerOperation>>;
  definitions: Record<string, JsonSchema>;
}

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  format?: string;
  $ref?: string;
  additionalProperties?: boolean | JsonSchema;
};

export interface ToolDef {
  name: string;
  path: string;
  method: string;
  tag: string;
  category: CategoryMeta;
  /** Full description shown to the model, including the category banner. */
  description: string;
  inputSchema: JsonSchema;
  title: string;
}

let _spec: SwaggerSpec | null = null;
function spec(): SwaggerSpec {
  if (!_spec) {
    _spec = JSON.parse(readFileSync(SPEC_PATH, "utf8")) as SwaggerSpec;
  }
  return _spec;
}

export function specInfo(): { title: string; version: string; baseUrl: string } {
  const s = spec();
  return { title: s.info.title, version: s.info.version, baseUrl: s.basePath };
}

/** `/postings/add-batch/free` -> `postings_add_batch_free` */
function toToolName(path: string): string {
  return path
    .replace(/^\//, "")
    .replace(/[/-]/g, "_")
    .replace(/__+/g, "_");
}

/** `/transactions/get/id_by_customer` -> `Transactions: get by customer id` */
function toTitle(path: string, op: SwaggerOperation): string {
  const tag = op.tags?.[0] ?? "";
  const summary = (op.summary || "").trim();
  return summary ? `${tag}: ${summary}` : toToolName(path);
}

/** Strip the HTML the BB docs embed in descriptions down to readable text. */
function cleanDescription(raw?: string): string {
  if (!raw) return "";
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(i|b|em|strong|code)>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&sect;/g, "§")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Resolve a Swagger schema (following `$ref` into definitions) into a plain
 * JSON Schema the MCP host can validate against. Guards against cycles.
 */
function resolveSchema(
  schema: JsonSchema | undefined,
  defs: Record<string, JsonSchema>,
  seen: Set<string> = new Set(),
  depth = 0
): JsonSchema {
  if (!schema || depth > 12) return {};
  if (schema.$ref) {
    const key = schema.$ref.replace("#/definitions/", "");
    if (seen.has(key)) return {}; // cycle guard
    seen.add(key);
    return resolveSchema(defs[key], defs, seen, depth + 1);
  }
  const out: JsonSchema = {};
  if (schema.type) out.type = schema.type;
  if (schema.format) out.format = schema.format;
  if (schema.description) out.description = cleanDescription(schema.description);
  if (schema.enum) out.enum = schema.enum;
  if (schema.items) out.items = resolveSchema(schema.items, defs, seen, depth + 1);
  if (schema.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      out.properties[k] = resolveSchema(v, defs, seen, depth + 1);
    }
  }
  if (schema.required) out.required = schema.required;
  return out;
}

/** Build the JSON-Schema property for a single Swagger parameter. */
function paramToProperty(
  p: SwaggerParam,
  defs: Record<string, JsonSchema>
): JsonSchema {
  // Batch/object params carry a full schema (often a $ref into definitions).
  if (p.schema) {
    const resolved = resolveSchema(p.schema, defs);
    if (p.description) {
      resolved.description = [cleanDescription(p.description), resolved.description]
        .filter(Boolean)
        .join("\n");
    }
    return resolved;
  }

  const prop: JsonSchema = {};
  if (p.type === "array") {
    prop.type = "array";
    // Many BB array params declare no item type; allow string-or-number items
    // (e.g. amounts vs. posting-account numbers) rather than over-constraining.
    prop.items = p.items
      ? resolveSchema(p.items, defs)
      : { type: ["string", "number"] };
  } else if (p.type) {
    prop.type = p.type;
  }
  if (p.format) prop.format = p.format;
  if (p.enum) prop.enum = p.enum;
  if (p.description) prop.description = cleanDescription(p.description);
  return prop;
}

/** Generate the complete, ordered list of MCP tool definitions. */
export function buildToolDefs(): ToolDef[] {
  const s = spec();
  const defs = s.definitions || {};
  const tools: ToolDef[] = [];

  for (const path of Object.keys(s.paths)) {
    const methods = s.paths[path];
    for (const method of Object.keys(methods)) {
      const op = methods[method];
      const category = categoryForPath(path);
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const p of op.parameters ?? []) {
        // `api_key` is injected by the server from configuration, so it is
        // exposed as an OPTIONAL override rather than a required field.
        if (p.name === "api_key") {
          properties[p.name] = {
            type: "string",
            description:
              "Optional. The BB customer api_key to act on. Defaults to the BB_API_KEY configured on the server — only set this to target a different customer.",
          };
          continue;
        }
        properties[p.name] = paramToProperty(p, defs);
        if (p.required) required.push(p.name);
      }

      const inputSchema: JsonSchema = {
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      };

      const banner = `${category.banner} — ${category.blurb}`;
      const summary = cleanDescription(op.summary);
      const longDesc = cleanDescription(op.description);
      const description = [
        banner,
        "",
        summary && `**${summary}**`,
        longDesc && longDesc !== summary ? longDesc : "",
        `\nEndpoint: POST ${path}`,
      ]
        .filter((x) => x !== undefined && x !== "")
        .join("\n");

      tools.push({
        name: toToolName(path),
        path,
        method: method.toUpperCase(),
        tag: op.tags?.[0] ?? "Other",
        category,
        description,
        inputSchema,
        title: toTitle(path, op),
      });
    }
  }

  // Stable, category-grouped ordering: reads first, deletes last.
  const order: Record<string, number> = {
    read: 0,
    create: 1,
    update: 2,
    link: 3,
    revert: 4,
    delete: 5,
  };
  tools.sort((a, b) => {
    const c = order[a.category.id] - order[b.category.id];
    return c !== 0 ? c : a.name.localeCompare(b.name);
  });

  return tools;
}
