import { z } from 'zod';

// Strict orchestration schemas reach ten levels through
// inputSchema -> graph -> tasks -> task -> epochs. Keep the transport bounded
// while leaving enough headroom for those first-party definitions.
const MAX_JSON_DEPTH = 12;
const MAX_JSON_ENTRIES = 100;
const MAX_JSON_KEY_LENGTH = 120;
const MAX_JSON_STRING_LENGTH = 65_536;

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
  z.string().max(MAX_JSON_STRING_LENGTH),
]);
const jsonKeySchema = z.string().min(1).max(MAX_JSON_KEY_LENGTH);

function jsonValueAtDepth(depth: number): z.ZodType<RuntimeJsonValue> {
  if (depth === 0) {
    return jsonPrimitiveSchema;
  }
  const child = jsonValueAtDepth(depth - 1);
  return z.union([
    jsonPrimitiveSchema,
    z.array(child).max(MAX_JSON_ENTRIES),
    z
      .record(jsonKeySchema, child)
      .refine(
        (value) => Object.keys(value).length <= MAX_JSON_ENTRIES,
        'Runtime JSON object has too many entries',
      ),
  ]);
}

export const runtimeJsonValueSchema: z.ZodType<RuntimeJsonValue> = jsonValueAtDepth(MAX_JSON_DEPTH);
export const runtimeJsonObjectSchema: z.ZodType<RuntimeJsonObject> = z
  .record(jsonKeySchema, runtimeJsonValueSchema)
  .refine(
    (value) => Object.keys(value).length <= MAX_JSON_ENTRIES,
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
