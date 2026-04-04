import { z } from 'zod'
import { defineAction } from '@maisie/shared'
import { getClients } from './clients'

// Shared schemas

const bookSchema = z.object({
  id: z.number(),
  title: z.string(),
  authors: z.array(z.string()),
  series: z.string().nullable(),
  seriesIndex: z.number().nullable(),
  tags: z.array(z.string()),
  formats: z.array(z.string()),
  identifiers: z.record(z.string(), z.string()),
  publisher: z.string().nullable(),
  pubdate: z.string().nullable(),
  rating: z.number(),
  languages: z.array(z.string()),
  comments: z.string().nullable(),
  timestamp: z.string(),
  coverUrl: z.string().optional(),
})

const enrichmentEntrySchema = z.object({
  bookId: z.number(),
  libraryId: z.string().nullable(),
  title: z.string().nullable(),
  authors: z.array(z.string()),
  status: z.string().nullable(),
  scanDate: z.string().nullable(),
  gaps: z.record(z.string(), z.boolean()).nullable(),
  proposedChanges: z.record(z.string(), z.unknown()).nullable(),
  changeSource: z.string().nullable(),
  confidence: z.number().nullable(),
  reviewedAt: z.string().nullable(),
  appliedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
})

const externalBookSchema = z.object({
  md5: z.string(),
  title: z.string(),
  author: z.string(),
  publisher: z.string(),
  year: z.string(),
  language: z.string(),
  fileType: z.string(),
  fileSize: z.string(),
  fileSizeBytes: z.number(),
  coverUrl: z.string(),
  detailUrl: z.string(),
  score: z.number(),
})

// --- Library actions ---

export const searchBooks = defineAction({
  name: 'list_books',
  description: 'Search the Calibre ebook library by title, author, or keyword. Returns matching books with metadata.',
  input: z.object({
    query: z.string(),
    limit: z.number().default(20),
  }),
  output: z.array(bookSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform', description: 'Search the Calibre ebook library by title, author, or keyword.' },
  ui: { type: 'data', label: 'Search Books', section: 'library' },
  async execute(input, _ctx) {
    const { calibre } = getClients()
    if (!calibre) throw new Error('Calibre not configured')
    const info = await calibre.getLibraryInfo()
    const libraryId = info.default_library
    const search = await calibre.search(libraryId, input.query, input.limit, 0, 'timestamp', 'desc')
    if (search.book_ids.length === 0) return []
    const books = await calibre.getBooks(search.book_ids, libraryId)
    return search.book_ids
      .map((id) => books[String(id)])
      .filter(Boolean)
      .map((b) => ({
        id: b.application_id,
        title: b.title,
        authors: b.authors,
        series: b.series,
        seriesIndex: b.series_index,
        tags: b.tags,
        formats: b.formats,
        identifiers: b.identifiers,
        publisher: b.publisher,
        pubdate: b.pubdate,
        rating: b.rating,
        languages: b.languages,
        comments: b.comments,
        timestamp: b.timestamp,
        coverUrl: calibre.getCoverUrl(b.application_id, libraryId),
      }))
  },
})

export const getBookCount = defineAction({
  name: 'get_book_count',
  description: 'Get the total number of books in the Calibre library and a breakdown by file format.',
  input: z.object({}),
  output: z.object({
    total: z.number(),
    byFormat: z.record(z.string(), z.number()),
  }),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Book Count', section: 'library' },
  async execute(_input, _ctx) {
    const { calibre } = getClients()
    if (!calibre) throw new Error('Calibre not configured')
    const info = await calibre.getLibraryInfo()
    const libraryId = info.default_library
    const search = await calibre.search(libraryId, '', 1)
    const total = search.total_num

    // Sample up to 100 books for format breakdown
    const sample = await calibre.search(libraryId, '', 100, 0, 'timestamp', 'desc')
    const sampleBooks = sample.book_ids.length > 0
      ? await calibre.getBooks(sample.book_ids, libraryId)
      : {}
    const byFormat: Record<string, number> = {}
    for (const book of Object.values(sampleBooks)) {
      for (const fmt of book.formats) {
        byFormat[fmt] = (byFormat[fmt] || 0) + 1
      }
    }

    return { total, byFormat }
  },
})

export const getBook = defineAction({
  name: 'get_book',
  description: 'Get full metadata for a specific book by its Calibre ID.',
  input: z.object({ id: z.number() }),
  output: bookSchema,
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: false,
  async execute(input, _ctx) {
    const { calibre } = getClients()
    if (!calibre) throw new Error('Calibre not configured')
    const info = await calibre.getLibraryInfo()
    const libraryId = info.default_library
    const b = await calibre.getBook(input.id, libraryId)
    return {
      id: b.application_id,
      title: b.title,
      authors: b.authors,
      series: b.series,
      seriesIndex: b.series_index,
      tags: b.tags,
      formats: b.formats,
      identifiers: b.identifiers,
      publisher: b.publisher,
      pubdate: b.pubdate,
      rating: b.rating,
      languages: b.languages,
      comments: b.comments,
      timestamp: b.timestamp,
      coverUrl: calibre.getCoverUrl(b.application_id, libraryId),
    }
  },
})

export const getLibraryStats = defineAction({
  name: 'get_library_stats',
  description: 'Get Calibre library statistics: total books, authors, tags, and format breakdown.',
  input: z.object({}),
  output: z.object({
    bookCount: z.number(),
    authorCount: z.number(),
    tagCount: z.number(),
    formats: z.record(z.string(), z.number()),
  }),
  http: { method: 'GET' },
  ai: { tier: 'inform', description: 'Get Calibre library statistics: total books, authors, tags, and format breakdown.' },
  ui: { type: 'data', label: 'Library Stats', section: 'library' },
  async execute(_input, _ctx) {
    const { calibre } = getClients()
    if (!calibre) throw new Error('Calibre not configured')

    // Use getCalibreStatus for full stats
    const { getCalibreStatus } = await import('./client')
    const status = await getCalibreStatus(calibre)

    return {
      bookCount: status.totalBooks,
      authorCount: status.totalAuthors,
      tagCount: status.totalTags,
      formats: status.formats,
    }
  },
})

export const getAuthors = defineAction({
  name: 'list_authors',
  description: 'Get all authors in the Calibre library with their book counts.',
  input: z.object({}),
  output: z.array(z.object({
    name: z.string(),
    bookCount: z.number(),
  })),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Authors', section: 'library' },
  async execute(_input, _ctx) {
    const { calibre } = getClients()
    if (!calibre) throw new Error('Calibre not configured')
    const info = await calibre.getLibraryInfo()
    const libraryId = info.default_library
    const CATEGORY_HEX_AUTHORS = "617574686f7273"
    const result = await calibre.getCategoryItems(CATEGORY_HEX_AUTHORS, libraryId)
    return result.items.map((item) => ({
      name: item.name,
      bookCount: item.count,
    }))
  },
})

export const searchExternalBooks = defineAction({
  name: 'list_external_books',
  description: "Search external book sources (Anna's Archive) for a title. Returns scored results with format and language info.",
  input: z.object({
    query: z.string(),
    limit: z.number().default(5),
  }),
  output: z.array(externalBookSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform', description: "Search external book sources (Anna's Archive) for a title." },
  ui: { type: 'data', label: 'Find Books Online', section: 'library' },
  async execute(input, _ctx) {
    const { searchAnnasArchive } = await import('./book-search')
    const results = await searchAnnasArchive(input.query)
    return results.slice(0, input.limit)
  },
})

// --- Enrichment actions ---

export const scanEnrichmentGaps = defineAction({
  name: 'invoke_scan_enrichment',
  description: 'Scan the library for books missing metadata (tags, series, ISBN). Returns a list of books that would benefit from enrichment. Present results to user before running enrichment.',
  input: z.object({
    limit: z.number().default(50),
  }),
  output: z.object({
    count: z.number(),
    books: z.array(z.object({
      id: z.number(),
      title: z.string(),
      missingFields: z.array(z.string()),
    })),
  }),
  http: { method: 'POST' },
  ai: {
    tier: 'advise',
    description: 'Scan the library for books missing metadata (tags, series, ISBN). Returns a list of books that would benefit from enrichment. Present results to user before running enrichment.',
  },
  ui: { type: 'action', label: 'Scan Gaps', section: 'enrichment' },
  async execute(input, _ctx) {
    const { calibre, db } = getClients()
    if (!calibre) throw new Error('Calibre not configured')
    if (!db) throw new Error('Database not configured')

    const { scanLibrary } = await import('./enrichment/scanner')
    await scanLibrary(db, calibre)

    // Query the enrichment table for pending items up to limit
    const { calibreEnrichment } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')
    const rows = db
      .select()
      .from(calibreEnrichment)
      .where(eq(calibreEnrichment.status, 'pending'))
      .limit(input.limit)
      .all()

    const books = rows.map((row) => {
      const gaps = row.gaps ? JSON.parse(row.gaps) : {}
      const missingFields = Object.entries(gaps)
        .filter(([, missing]) => missing)
        .map(([field]) => field)
      return {
        id: row.bookId,
        title: row.title || '',
        missingFields,
      }
    })

    return { count: books.length, books }
  },
})

export const runEnrichmentLookup = defineAction({
  name: 'invoke_enrichment_lookup',
  description: 'Run external metadata lookups (Open Library, Google Books) for books with gaps. Stores proposed changes for review — does NOT apply them.',
  input: z.object({
    limit: z.number().default(10),
  }),
  output: z.object({
    processed: z.number(),
    enriched: z.number(),
    failed: z.number(),
  }),
  http: { method: 'POST' },
  ai: {
    tier: 'advise',
    description: 'Run external metadata lookups (Open Library, Google Books) for books with gaps. Stores proposed changes for review — does NOT apply them.',
  },
  ui: { type: 'action', label: 'Run Lookups', section: 'enrichment' },
  async execute(input, _ctx) {
    const { db } = getClients()
    if (!db) throw new Error('Database not configured')
    const { runLookups } = await import('./enrichment/pipeline')
    const result = await runLookups(db, { batchSize: input.limit })
    return {
      processed: result.processed,
      enriched: result.found,
      failed: result.errors,
    }
  },
})

export const getEnrichmentQueue = defineAction({
  name: 'list_enrichment_queue',
  description: 'Get books with proposed metadata changes awaiting human review.',
  input: z.object({
    status: z.enum(['enriched', 'reviewed']).optional(),
  }),
  output: z.array(enrichmentEntrySchema),
  http: { method: 'GET' },
  ai: { tier: 'inform', description: 'Get books with proposed metadata changes awaiting human review.' },
  ui: { type: 'data', label: 'Review Queue', section: 'enrichment', realtimeTopic: 'home/calibre/enrichment/+' },
  async execute(input, _ctx) {
    const { db } = getClients()
    if (!db) throw new Error('Database not configured')

    const { calibreEnrichment } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')

    let rows = db.select().from(calibreEnrichment).all()
    if (input.status) {
      rows = rows.filter((r) => r.status === input.status)
    }

    return rows.map((row) => ({
      bookId: row.bookId,
      libraryId: row.libraryId,
      title: row.title,
      authors: row.authors ? JSON.parse(row.authors) : [],
      status: row.status,
      scanDate: row.scanDate,
      gaps: row.gaps ? JSON.parse(row.gaps) : null,
      proposedChanges: row.proposedChanges ? JSON.parse(row.proposedChanges) : null,
      changeSource: row.changeSource,
      confidence: row.confidence,
      reviewedAt: row.reviewedAt,
      appliedAt: row.appliedAt,
      errorMessage: row.errorMessage,
    }))
  },
})

export const applyEnrichment = defineAction({
  name: 'invoke_apply_enrichment',
  description: 'Apply approved metadata changes to Calibre for a specific book. This writes to the library — only call after user has reviewed and approved.',
  input: z.object({ bookId: z.number() }),
  output: z.object({
    success: z.boolean(),
    fieldsApplied: z.array(z.string()),
  }),
  http: { method: 'POST' },
  ai: {
    tier: 'advise',
    description: 'Apply approved metadata changes to Calibre for a specific book. This writes to the library — only call after user has reviewed and approved.',
  },
  ui: { type: 'action', label: 'Apply Changes', section: 'enrichment' },
  async execute(input, ctx) {
    const { db, calibreExec } = getClients()
    if (!db) throw new Error('Database not configured')
    if (!calibreExec) throw new Error('Calibre exec not configured')
    const { applyEnrichment: apply } = await import('./enrichment/applier')
    const result = await apply(db, calibreExec, input.bookId)

    // Fetch title for event
    const { calibreEnrichment } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')
    const row = db.select().from(calibreEnrichment).where(eq(calibreEnrichment.bookId, input.bookId)).get()

    if (result.success) {
      ctx.emit('home/calibre/enrichment/applied', {
        bookId: input.bookId,
        title: row?.title || '',
        fieldsUpdated: result.fieldsApplied,
      })
    }

    return { success: result.success, fieldsApplied: result.fieldsApplied }
  },
})

export const rejectEnrichment = defineAction({
  name: 'invoke_reject_enrichment',
  description: 'Skip metadata enrichment for a specific book, marking it as reviewed with no changes applied.',
  input: z.object({ bookId: z.number() }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'POST' },
  ai: { tier: 'advise' },
  ui: { type: 'action', label: 'Skip', section: 'enrichment' },
  async execute(input, _ctx) {
    const { db } = getClients()
    if (!db) throw new Error('Database not configured')
    const { calibreEnrichment } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')
    db.update(calibreEnrichment)
      .set({ status: 'skipped', reviewedAt: new Date().toISOString() })
      .where(eq(calibreEnrichment.bookId, input.bookId))
      .run()
    return { success: true }
  },
})

export const getCalibreStatus = defineAction({
  name: 'get_calibre_status',
  description: 'Get combined Calibre library status: all libraries with book counts, total stats, and recently added.',
  input: z.object({}),
  output: z.object({
    libraries: z.array(z.object({ id: z.string(), name: z.string(), bookCount: z.number() })),
    totalBooks: z.number(),
    totalAuthors: z.number(),
    totalTags: z.number(),
    formats: z.record(z.string(), z.number()),
    recentlyAdded: z.array(z.object({ id: z.number(), title: z.string(), authors: z.array(z.string()), added: z.string() })),
    timestamp: z.string(),
  }),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Calibre Status', section: 'library' },
  async execute(_input, _ctx) {
    const { calibre } = getClients()
    if (!calibre) throw new Error('Calibre not configured')
    const { getCalibreStatus: fetchStatus } = await import('./client')
    return fetchStatus(calibre)
  },
})
