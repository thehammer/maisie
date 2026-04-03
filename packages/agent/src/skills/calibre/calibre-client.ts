interface CalibreConfig {
  host: string;
  port: number;
}

interface CalibreLibraryInfo {
  library_map: Record<string, string>;
  default_library: string;
}

interface CalibreSearchResult {
  total_num: number;
  sort_order: string;
  num_books_without_search: number;
  offset: number;
  num: number;
  sort: string;
  library_id: string;
  book_ids: number[];
}

export interface CalibreBook {
  application_id: number;
  title: string;
  title_sort: string;
  authors: string[];
  author_sort: string;
  publisher: string | null;
  series: string | null;
  series_index: number | null;
  tags: string[];
  rating: number;
  languages: string[];
  formats: string[];
  identifiers: Record<string, string>;
  pubdate: string | null;
  timestamp: string;
  last_modified: string;
  comments: string | null;
  cover: string | null;
  uuid: string;
}

interface CalibreCategory {
  name: string;
  url: string;
  icon: string;
  is_category: boolean;
}

export interface CalibreLibrary {
  id: string;
  name: string;
  bookCount: number;
}

export interface CalibreStatus {
  libraries: CalibreLibrary[];
  totalBooks: number;
  totalAuthors: number;
  totalTags: number;
  formats: Record<string, number>;
  recentlyAdded: { id: number; title: string; authors: string[]; added: string }[];
  timestamp: string;
}

export function createCalibreClient(config: CalibreConfig) {
  const baseUrl = `http://${config.host}:${config.port}`;

  async function request<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(`Calibre ${res.status}: ${res.statusText} — ${path}`);
    }
    return res.json();
  }

  return {
    async getLibraryInfo(): Promise<CalibreLibraryInfo> {
      return request("/ajax/library-info");
    },

    async search(libraryId: string, query = "", num = 50, offset = 0, sort = "timestamp", order = "desc"): Promise<CalibreSearchResult> {
      const params = new URLSearchParams({
        query,
        num: String(num),
        offset: String(offset),
        sort,
        sort_order: order,
        library_id: libraryId,
      });
      return request(`/ajax/search?${params}`);
    },

    async getBook(bookId: number, libraryId: string): Promise<CalibreBook> {
      return request(`/ajax/book/${bookId}/${libraryId}`);
    },

    async getBooks(bookIds: number[], libraryId: string): Promise<Record<string, CalibreBook>> {
      const ids = bookIds.join(",");
      return request(`/ajax/books/${libraryId}?ids=${ids}`);
    },

    async getCategories(libraryId: string): Promise<CalibreCategory[]> {
      return request(`/ajax/categories/${libraryId}`);
    },

    async getCategoryItems(categoryHex: string, libraryId: string, num = 1000): Promise<{ total_num: number; items: { name: string; count: number; url: string }[] }> {
      return request(`/ajax/category/${categoryHex}/${libraryId}?num=${num}`);
    },

    getCoverUrl(bookId: number, libraryId: string): string {
      return `${baseUrl}/get/cover/${bookId}/${libraryId}`;
    },

    getThumbnailUrl(bookId: number, libraryId: string): string {
      return `${baseUrl}/get/thumb/${bookId}/${libraryId}`;
    },

    async getAllBooks(libraryId: string, batchSize = 50): Promise<CalibreBook[]> {
      const all: CalibreBook[] = [];
      let offset = 0;
      while (true) {
        const search = await this.search(libraryId, "", batchSize, offset, "id", "asc");
        if (search.book_ids.length === 0) break;
        const books = await this.getBooks(search.book_ids, libraryId);
        for (const id of search.book_ids) {
          const book = books[String(id)];
          if (book) all.push(book);
        }
        offset += batchSize;
        if (offset >= search.total_num) break;
      }
      return all;
    },
  };
}

// Category hex codes used by Calibre's AJAX API
const CATEGORY_HEX = {
  authors: "617574686f7273",
  tags: "74616773",
  series: "736572696573",
  publisher: "7075626c6973686572",
  languages: "6c616e677561676573",
  rating: "726174696e67",
} as const;

export async function getCalibreStatus(
  client: ReturnType<typeof createCalibreClient>,
): Promise<CalibreStatus> {
  const libraryInfo = await client.getLibraryInfo();

  const libraries: CalibreLibrary[] = [];
  let totalBooks = 0;

  for (const [id, name] of Object.entries(libraryInfo.library_map)) {
    const search = await client.search(id, "", 1);
    libraries.push({ id, name, bookCount: search.total_num });
    totalBooks += search.total_num;
  }

  // Get stats from default library
  const defaultLib = libraryInfo.default_library;
  const [authors, tags] = await Promise.all([
    client.getCategoryItems(CATEGORY_HEX.authors, defaultLib),
    client.getCategoryItems(CATEGORY_HEX.tags, defaultLib),
  ]);

  // Get recently added books (last 10)
  const recent = await client.search(defaultLib, "", 10, 0, "timestamp", "desc");
  const recentBooks = await client.getBooks(recent.book_ids, defaultLib);

  const recentlyAdded = recent.book_ids.map((id) => {
    const book = recentBooks[String(id)];
    return {
      id,
      title: book.title,
      authors: book.authors,
      added: book.timestamp,
    };
  });

  // Count formats across recent books (sample)
  const allSearch = await client.search(defaultLib, "", 100, 0, "timestamp", "desc");
  const allBooks = await client.getBooks(allSearch.book_ids, defaultLib);
  const formats: Record<string, number> = {};
  for (const book of Object.values(allBooks)) {
    for (const fmt of book.formats) {
      formats[fmt] = (formats[fmt] || 0) + 1;
    }
  }

  return {
    libraries,
    totalBooks,
    totalAuthors: authors.total_num,
    totalTags: tags.total_num,
    formats,
    recentlyAdded,
    timestamp: new Date().toISOString(),
  };
}

export function createCalibreClientFromEnv() {
  const host = process.env.CALIBRE_HOST;
  const port = Number(process.env.CALIBRE_PORT) || 8081;
  if (!host) return null;
  return createCalibreClient({ host, port });
}
