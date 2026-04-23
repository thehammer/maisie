/**
 * Proposal agent tool for Phase 4e.
 *
 * propose_artifact — Tier: inform
 *
 * The agent calls this to emit a draft proposal for a derived entity or
 * component. Creating a proposal is merely a suggestion: it requires human
 * approval via the dashboard before the artifact is saved to the catalog.
 * This is intentionally lower-tier than save_entity/save_component (advise)
 * because no catalog change is made here — the proposal just enters the
 * review queue.
 *
 * Approval happens via the HTTP routes in api/proposals.ts, which delegate
 * to the same code path as save_entity/save_component.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { parse } from '@maisie/shared'
import type { ParsedEntity, ParsedComponent } from '@maisie/shared'
import type { ProposalStore } from '../services/proposal-store'

export interface ProposalToolDeps {
  proposalStore: ProposalStore
}

export function createProposalTools(deps: ProposalToolDeps) {
  const { proposalStore } = deps

  const proposeArtifact = tool({
    description:
      'Propose a derived entity or component for human review. ' +
      'The MEL source is validated and stored as a pending proposal; ' +
      'the user reviews and approves or rejects it in the dashboard. ' +
      'No catalog change is made until the user approves. ' +
      'Use this to suggest persistent views, dashboards, or components ' +
      'without directly modifying the catalog. Tier: inform.',
    inputSchema: z.object({
      source: z.string().describe(
        'MEL source string for a define block (entity or component). ' +
        'Example: "define late-packages { count: number = 3 }"',
      ),
      reasoning: z.string().optional().describe(
        'Why you are proposing this artifact. Shown to the user during review.',
      ),
    }),
    execute: async ({ source, reasoning }: { source: string; reasoning?: string }) => {
      // Parse and validate the source before creating the proposal.
      let parsed: ReturnType<typeof parse>
      try {
        parsed = parse(source)
      } catch (err) {
        return {
          error: `MEL parse error: ${err instanceof Error ? err.message : String(err)}`,
        }
      }

      if (parsed === null || typeof parsed !== 'object') {
        return {
          error: 'Source must be a define block, not a plain expression.',
        }
      }

      if (!('kind' in parsed)) {
        return {
          error: 'Source must be a define block (entity or component).',
        }
      }

      const typedParsed = parsed as ParsedEntity | ParsedComponent
      if (typedParsed.kind !== 'entity' && typedParsed.kind !== 'component') {
        return {
          error: 'Source must be a define block (entity or component), not a plain expression.',
        }
      }

      const kind = typedParsed.kind === 'component' ? 'component' as const : 'entity' as const
      const name = typedParsed.name

      const proposal = await proposalStore.create({
        kind,
        name,
        source,
        reasoning,
      })

      return {
        id: proposal.id,
        kind: proposal.kind,
        name: proposal.name,
        status: proposal.status,
        reasoning: proposal.reasoning,
        message: `Proposal created. The user can review and approve it in the dashboard.`,
      }
    },
  })

  return { propose_artifact: proposeArtifact }
}
