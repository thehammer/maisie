/**
 * Thin wrapper around the epub2 parser.
 *
 * Limitation: HTML stripping is done via a simple regex approach rather than
 * a full DOM parser. This is acceptable for v1 — it handles common prose EPUB
 * HTML but may leave artefacts from complex layouts or inline scripts/styles.
 * A follow-on plan can substitute cheerio or linkedom for production quality.
 */

import { EPub } from 'epub2'
import type { TocElement } from 'epub2/lib/epub/const'

export interface EpubSpineItem {
  id: string
  href: string
  order: number
  title?: string
}

export interface EpubMetadata {
  title?: string
  author?: string
  language?: string
}

export interface EpubHandle {
  metadata: EpubMetadata
  spine: EpubSpineItem[]
  /** Fetch and strip a single chapter by its spine id */
  getChapterText(spineId: string): Promise<{ title: string; html: string; plainText: string }>
}

/**
 * Strip HTML tags, collapse whitespace, and normalise to plain text.
 * Handles paragraph breaks, heading tags, and list items as newlines.
 * NOTE: Regex-based; not suitable for malformed or adversarial HTML.
 */
export function stripHtml(html: string): string {
  return html
    // Replace block-level tags with newlines before stripping
    .replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote)[^>]*>/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse multiple blank lines to two newlines (= section boundary)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Parse an EPUB file and return an EpubHandle with metadata, spine, and
 * a method to fetch chapter text.
 *
 * Uses EPub.createAsync() from epub2 which wraps the event-based parser
 * in a Promise.
 */
export async function loadEpub(epubPath: string): Promise<EpubHandle> {
  // createAsync fires the event-based epub.parse() and resolves when 'end' fires.
  const epub = await EPub.createAsync(epubPath)

  const metadata: EpubMetadata = {
    title: epub.metadata?.title,
    author: epub.metadata?.creator,
    language: epub.metadata?.language,
  }

  // epub.flow is the spine in reading order — an array of TocElement
  const spine: EpubSpineItem[] = (epub.flow ?? []).map(
    (item: TocElement, idx: number) => ({
      id: String(item.id ?? ''),
      href: String(item.href ?? ''),
      order: typeof item.order === 'number' ? item.order : idx + 1,
      title: item.title,
    }),
  )

  return {
    metadata,
    spine,
    async getChapterText(spineId: string) {
      const html = await epub.getChapterRawAsync(spineId)
      const plainText = stripHtml(html)
      // Try to extract a title from the HTML <title> or first heading
      const titleMatch =
        html.match(/<title[^>]*>([^<]+)<\/title>/i) ??
        html.match(/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/i)
      const title = titleMatch ? stripHtml(titleMatch[1]).trim() : spineId
      return { title, html, plainText }
    },
  }
}
