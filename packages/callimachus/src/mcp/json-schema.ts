import { zodToJsonSchema } from 'zod-to-json-schema'

/**
 * Convert a Zod schema to a JSON Schema 7 object.
 * Uses $refStrategy 'none' to inline all refs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toJsonSchema(schema: any): object {
  return zodToJsonSchema(schema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as object
}
