/**
 * Persistence layer for agent-proposed artifacts.
 *
 * Proposals are derived entities or components suggested by the agent that
 * require human approval before being saved to the catalog. The store provides
 * simple CRUD operations against the `proposals` SQLite table via Drizzle.
 *
 * Mirrors the pattern of derived-entity-store in plugin-core.
 */

import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { eq } from 'drizzle-orm'
import { proposals } from './schema'

export interface Proposal {
  id: string
  kind: 'entity' | 'component'
  name: string
  source: string
  reasoning?: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: Date
  resolvedAt?: Date
}

export interface ProposalStore {
  create(proposal: Omit<Proposal, 'id' | 'status' | 'createdAt'>): Promise<Proposal>
  list(filter?: { status?: 'pending' | 'approved' | 'rejected' }): Promise<Proposal[]>
  get(id: string): Promise<Proposal | null>
  markApproved(id: string): Promise<void>
  markRejected(id: string): Promise<void>
  delete(id: string): Promise<void>
}

export function createProposalStore(db: BunSQLiteDatabase<any>): ProposalStore {
  async function create(
    proposal: Omit<Proposal, 'id' | 'status' | 'createdAt'>,
  ): Promise<Proposal> {
    const id = crypto.randomUUID()
    const now = new Date()

    await db.insert(proposals).values({
      id,
      kind: proposal.kind,
      name: proposal.name,
      source: proposal.source,
      reasoning: proposal.reasoning ?? null,
      status: 'pending',
      createdAt: now,
      resolvedAt: null,
    })

    return {
      id,
      kind: proposal.kind,
      name: proposal.name,
      source: proposal.source,
      reasoning: proposal.reasoning,
      status: 'pending',
      createdAt: now,
    }
  }

  async function list(filter?: { status?: 'pending' | 'approved' | 'rejected' }): Promise<Proposal[]> {
    let rows: typeof proposals.$inferSelect[]
    if (filter?.status) {
      rows = await db.select().from(proposals).where(eq(proposals.status, filter.status)).all()
    } else {
      rows = await db.select().from(proposals).all()
    }
    return rows.map(rowToProposal)
  }

  async function get(id: string): Promise<Proposal | null> {
    const row = await db.select().from(proposals).where(eq(proposals.id, id)).get()
    if (!row) return null
    return rowToProposal(row)
  }

  async function markApproved(id: string): Promise<void> {
    await db
      .update(proposals)
      .set({ status: 'approved', resolvedAt: new Date() })
      .where(eq(proposals.id, id))
  }

  async function markRejected(id: string): Promise<void> {
    await db
      .update(proposals)
      .set({ status: 'rejected', resolvedAt: new Date() })
      .where(eq(proposals.id, id))
  }

  async function deleteProposal(id: string): Promise<void> {
    await db.delete(proposals).where(eq(proposals.id, id))
  }

  return { create, list, get, markApproved, markRejected, delete: deleteProposal }
}

function rowToProposal(row: typeof proposals.$inferSelect): Proposal {
  return {
    id: row.id,
    kind: row.kind as 'entity' | 'component',
    name: row.name,
    source: row.source,
    reasoning: row.reasoning ?? undefined,
    status: row.status as 'pending' | 'approved' | 'rejected',
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? undefined,
  }
}
