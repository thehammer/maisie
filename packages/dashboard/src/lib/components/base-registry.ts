/**
 * Re-exports BASE_COMPONENTS data from @maisie/shared.
 *
 * The ComponentDef records live in shared/ so the agent server can also import
 * them (for GET /api/components). The React implementations of each base
 * component remain in packages/dashboard/.
 */

export {
  BASE_COMPONENTS,
  getBaseComponent,
  listBaseComponents,
} from '@maisie/shared'
