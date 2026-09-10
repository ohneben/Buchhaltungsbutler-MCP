/**
 * Loads the bundled BuchhaltungsButler OpenAPI (Swagger 2.0) spec and turns
 * each path into a fully-formed MCP tool definition: a curated snake_case
 * name, a JSON-Schema input, a JSON-Schema output, the category banner, usage
 * guidance, and MCP annotations.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { categoryForPath, type CategoryMeta } from "./categories.js";
import { GUIDANCE } from "./guidance.js";
import {
  ABSORBED_PATHS,
  MERGED_PATHS,
  TOOL_NAMES,
  legacyToolName,
} from "./naming.js";

/**
 * Whether a tool call may override the configured BB_API_KEY. Off by default
 * since 1.1.0; set BB_ALLOW_API_KEY_OVERRIDE=1 to restore the old behaviour.
 */
export function apiKeyOverrideAllowed(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return /^(1|true|yes)$/i.test((env.BB_ALLOW_API_KEY_OVERRIDE ?? "").trim());
}


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

interface SwaggerResponse {
  description?: string;
  schema?: JsonSchema;
}

interface SwaggerOperation {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: SwaggerParam[];
  responses?: Record<string, SwaggerResponse>;
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
  /** Shape of a successful response, from the spec's 200 schema. */
  outputSchema: JsonSchema;
  title: string;
  /**
   * Set on merged batch tools. `path` is the batch endpoint; a call that
   * arrives with the single-record fields instead of `batchParam` is routed
   * to `singlePath` so pre-merge callers keep working.
   */
  singlePath?: string;
  batchParam?: string;
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

/** `/receipts/get/id_by_customer` -> `Receipts: get receipt by id_by_customer` */
function toTitle(path: string, op: SwaggerOperation): string {
  const tag = op.tags?.[0] ?? "";
  const summary = (op.summary || "").trim();
  return summary ? `${tag}: ${summary}` : legacyToolName(path);
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

/**
 * Drop `required` entries that name a property the schema does not declare.
 * The upstream spec has a few of these (the batch free-posting item requires
 * "amounts" while the field is called "amount"), and advertising a constraint
 * no valid payload can satisfy sends the model chasing a field that does not
 * exist.
 */
function dropPhantomRequired(schema: JsonSchema): JsonSchema {
  if (schema.required && schema.properties) {
    const known = new Set(Object.keys(schema.properties));
    const kept = schema.required.filter((r) => known.has(r));
    if (kept.length) schema.required = kept;
    else delete schema.required;
  }
  if (schema.items) dropPhantomRequired(schema.items);
  if (schema.properties) {
    for (const v of Object.values(schema.properties)) dropPhantomRequired(v);
  }
  return schema;
}

/**
 * Remove `enum` from a response schema. The spec uses enums there to carry
 * sample values ("receipt123", a single-element rows count), not real
 * constraints, so copying them into an output schema would describe every
 * real response as invalid.
 */
function stripResponseEnums(schema: JsonSchema): JsonSchema {
  delete schema.enum;
  if (schema.items) stripResponseEnums(schema.items);
  if (schema.properties) {
    for (const v of Object.values(schema.properties)) stripResponseEnums(v);
  }
  return schema;
}

/**
 * Copy parameter descriptions onto identically named fields of a batch item
 * schema. Several batch definitions carry examples but no prose, while their
 * single-record twin documents every field. Only matching names are touched,
 * never renamed: the batch endpoint's own field names stay authoritative
 * (`/postings/add-batch/receipts` really does spell it `postingstexts`).
 */
function enrichItemSchema(
  itemSchema: JsonSchema,
  singleParams: SwaggerParam[]
): void {
  const props = itemSchema.properties;
  if (!props) return;
  for (const p of singleParams) {
    const target = props[p.name];
    if (target && !target.description && p.description) {
      target.description = cleanDescription(p.description);
    }
  }
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

/** The 200 response schema, cleaned up for use as an MCP output schema. */
function buildOutputSchema(
  op: SwaggerOperation,
  defs: Record<string, JsonSchema>
): JsonSchema {
  const ok = op.responses?.["200"];
  const resolved = ok?.schema
    ? stripResponseEnums(resolveSchema(ok.schema, defs))
    : {};
  if (resolved.type !== "object" || !resolved.properties) {
    // Every v1 endpoint answers with a {success, ...} envelope; fall back to
    // that rather than declaring an output schema nothing can satisfy.
    return {
      type: "object",
      properties: {
        success: { type: "boolean", description: "Whether the call succeeded." },
        message: { type: "string" },
      },
      required: ["success"],
    };
  }
  resolved.required = ["success"];
  return resolved;
}

/** Assemble the description the model reads. */
function buildDescription(args: {
  category: CategoryMeta;
  op: SwaggerOperation;
  guidance?: { use: string; avoid?: string; note?: string };
  batch?: { param: string; itemLabel: string };
  path: string;
}): string {
  const { category, op, guidance, batch, path } = args;
  const summary = cleanDescription(op.summary);
  const longDesc = cleanDescription(op.description);

  const parts: string[] = [`${category.banner}: ${category.blurb}`];
  if (summary) parts.push(`**${summary}**`);
  if (longDesc && longDesc.toLowerCase() !== summary.toLowerCase())
    parts.push(longDesc);
  if (guidance?.use) parts.push(guidance.use);
  if (guidance?.avoid) parts.push(guidance.avoid);
  if (batch) {
    parts.push(
      `Takes one or many: pass an array of ${batch.itemLabel} in \`${batch.param}\`. A single record is an array of one.`
    );
  }
  if (guidance?.note) parts.push(guidance.note);
  parts.push(`Endpoint: POST ${path}`);

  return parts.filter(Boolean).join("\n\n");
}

/** Generate the complete, ordered list of MCP tool definitions. */
export function buildToolDefs(): ToolDef[] {
  const s = spec();
  const defs = s.definitions || {};
  const tools: ToolDef[] = [];

  for (const path of Object.keys(s.paths)) {
    // Single-record endpoints that a batch tool absorbed are still callable,
    // they just do not get a tool entry of their own.
    if (ABSORBED_PATHS.has(path)) continue;

    const methods = s.paths[path];
    for (const method of Object.keys(methods)) {
      const op = methods[method];
      const merge = MERGED_PATHS[path];
      const singleOp = merge
        ? Object.values(s.paths[merge.singlePath])[0]
        : undefined;
      const singleParams = (singleOp?.parameters ?? []).filter(
        (p) => p.name !== "api_key"
      );
      const category = categoryForPath(path);
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const p of op.parameters ?? []) {
        // `api_key` is injected by the server from configuration. It is only
        // advertised as an optional override when the operator opted in via
        // BB_ALLOW_API_KEY_OVERRIDE; otherwise it is not part of the schema at
        // all, so the model cannot choose which customer to act on.
        if (p.name === "api_key") {
          if (apiKeyOverrideAllowed()) {
            properties[p.name] = {
              type: "string",
              description:
                "Optional. The BB customer api_key to act on. Defaults to the BB_API_KEY configured on the server. Only set this to target a different customer.",
            };
          }
          continue;
        }
        properties[p.name] = paramToProperty(p, defs);
        if (p.required) required.push(p.name);
      }

      if (merge) {
        const arr = properties[merge.param];
        if (arr?.items) enrichItemSchema(arr.items, singleParams);
      }

      const inputSchema = dropPhantomRequired({
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      });

      // For a merged tool the single-record endpoint carries the better prose
      // (the batch summary is a bare "add batch receipts"), so describe the
      // capability from that and explain the array shape separately.
      const describedOp = singleOp ?? op;

      tools.push({
        name: TOOL_NAMES[path],
        path,
        method: method.toUpperCase(),
        tag: op.tags?.[0] ?? "Other",
        category,
        description: buildDescription({
          category,
          op: describedOp,
          guidance: GUIDANCE[path],
          batch: merge
            ? { param: merge.param, itemLabel: merge.param.replace(/_/g, " ") }
            : undefined,
          path,
        }),
        inputSchema,
        outputSchema: buildOutputSchema(op, defs),
        title: toTitle(path, describedOp),
        ...(merge
          ? { singlePath: merge.singlePath, batchParam: merge.param }
          : {}),
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
