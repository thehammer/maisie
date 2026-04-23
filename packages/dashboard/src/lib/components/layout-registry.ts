/**
 * Re-exports LAYOUT_PRIMITIVES data from @maisie/shared.
 *
 * The ComponentDef records live in shared/ so the agent server can also import
 * them (for GET /api/components). The React implementations of each layout
 * primitive remain in packages/dashboard/src/components/layout/.
 */

export {
  LAYOUT_PRIMITIVES,
  getLayoutPrimitive,
  listLayoutPrimitives,
  isLayoutPrimitive,
} from '@maisie/shared'
