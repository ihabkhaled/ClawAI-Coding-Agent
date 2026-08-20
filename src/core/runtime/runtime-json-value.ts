import { z } from 'zod';

// Strict orchestration schemas reach ten levels through
// inputSchema -> graph -> tasks -> task -> epochs. Keep the transport bounded
// while leaving enough headroom for those first-party definitions.
const MAX_JSON_DEPTH = 12;
export const MAX_RUNTIME_JSON_ENTRIES = 100;
// Arrays carry file bodies — `workspace.files` sends one array entry per source
// line — so they cannot share the object-entry cap without making every file
// over 100 lines unwritable. The byte budget remains the real bound.
export const MAX_RUNTIME_JSON_ARRAY_ITEMS = 4_000;
const MAX_JSON_KEY_LENGTH = 120;
export const MAX_RUNTIME_JSON_STRING_LENGTH = 65_536;

export type RuntimeJsonPrimitive = boolean | null | number | string;
export type RuntimeJsonValue =
  RuntimeJsonPrimitive | readonly RuntimeJsonValue[] | RuntimeJsonObject;
declare const runtimeJsonObjectBrand: unique symbol;
export interface RuntimeJsonObject extends Readonly<Record<string, RuntimeJsonValue>> {
  readonly [runtimeJsonObjectBrand]?: never;
}

const jsonPrimitiveSchema = z.union([
  z.null(),
  z.boolean(),
  z.number(),
  z.string().max(MAX_RUNTIME_JSON_STRING_LENGTH),
]);
const jsonKeySchema = z.string().min(1).max(MAX_JSON_KEY_LENGTH);

function jsonValueAtDepth(depth: number): z.ZodType<RuntimeJsonValue> {
  if (depth === 0) {
    return jsonPrimitiveSchema;
  }
  const child = jsonValueAtDepth(depth - 1);
  return z.union([
    jsonPrimitiveSchema,
    z.array(child).max(MAX_RUNTIME_JSON_ARRAY_ITEMS),
    z
      .record(jsonKeySchema, child)
      .refine(
        (value) => Object.keys(value).length <= MAX_RUNTIME_JSON_ENTRIES,
        'Runtime JSON object has too many entries',
      ),
  ]);
}

export const runtimeJsonValueSchema: z.ZodType<RuntimeJsonValue> = jsonValueAtDepth(MAX_JSON_DEPTH);
export const runtimeJsonObjectSchema: z.ZodType<RuntimeJsonObject> = z
  .record(jsonKeySchema, runtimeJsonValueSchema)
  .refine(
    (value) => Object.keys(value).length <= MAX_RUNTIME_JSON_ENTRIES,
    'Runtime JSON object has too many entries',
  );

export function boundedRuntimeJsonObject(maxBytes: number): z.ZodType<RuntimeJsonObject> {
  return runtimeJsonObjectSchema.superRefine((value, context) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (bytes > maxBytes) {
      context.addIssue({
        code: 'custom',
        message: `Runtime JSON exceeds the ${String(maxBytes)} byte limit`,
      });
    }
  });
}
