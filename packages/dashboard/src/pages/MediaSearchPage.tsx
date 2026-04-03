import { useState, useCallback, useEffect } from "react";

type Tab = "movie" | "tv" | "books" | "audiobooks";

interface MediaConfig {
  rootFolders: { id: number; path: string }[];
  qualityProfiles: { id: number; name: string }[];
  languageProfiles?: { id: number; name: string }[];
}

interface AAResult {
  md5: string;
  title: string;
  author: string;
  publisher: string;
  year: string;
  language: string;
  fileType: string;
  fileSize: string;
  coverUrl: string;
  score: number;
}

interface CalibreResult {
  title: string;
  authors: string[];
  formats: Record<string, string>;
  id: number;
  tags?: string[];
  series?: string;
  series_index?: number;
}

const API = import.meta.env.VITE_API_URL || "";

export function MediaSearchPage({ onBack, initialTab }: { onBack: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab || "movie");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  // Movie/TV state
  const [library, setLibrary] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [adding, setAdding] = useState<number | null>(null);
  const [config, setConfig] = useState<MediaConfig | null>(null);

  // Book state
  const [calibreResults, setCalibreResults] = useState<CalibreResult[]>([]);
  const [aaResults, setAaResults] = useState<AAResult[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [bookFormat, setBookFormat] = useState("epub");

  // Audiobook state (Prowlarr + Transmission)
  const [audiobookResults, setAudiobookResults] = useState<any[]>([]);

  const isMediaTab = tab === "movie" || tab === "tv";

  // Load config for movie/tv tabs
  useEffect(() => {
    if (!isMediaTab) return;
    setConfig(null);
    fetch(`${API}/api/media/config?type=${tab}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data && !data.error) setConfig(data); })
      .catch(() => {});
  }, [tab, isMediaTab]);

  const clearResults = () => {
    setLibrary([]);
    setResults([]);
    setCalibreResults([]);
    setAaResults([]);
    setAudiobookResults([]);
    setToast(null);
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    clearResults();
  };

  const search = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    clearResults();

    try {
      if (isMediaTab) {
        const res = await fetch(`${API}/api/media/search?q=${encodeURIComponent(query)}&type=${tab}`);
        const data = await res.json();
        if (data.error) {
          setToast({ text: data.error, ok: false });
        } else {
          setLibrary(data.library || []);
          setResults(data.results || []);
        }
      } else if (tab === "books") {
        const params = new URLSearchParams({ q: query });
        if (bookFormat) params.set("ext", bookFormat);
        const res = await fetch(`${API}/api/books/search?${params}`);
        const data = await res.json();
        setCalibreResults(data.calibre || []);
        setAaResults(data.annasArchive || []);
      } else if (tab === "audiobooks") {
        const res = await fetch(`${API}/api/audiobooks/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data.error) {
          setToast({ text: data.error, ok: false });
        } else {
          setAudiobookResults(data.results || []);
        }
      }
    } catch (err) {
      setToast({ text: `Search failed: ${err}`, ok: false });
    } finally {
      setSearching(false);
    }
  }, [query, tab, isMediaTab, bookFormat]);

  const handleMediaAdd = useCallback(async (item: any) => {
    if (!config) return;
    const rootFolder = config.rootFolders[0]?.path;
    const qualityProfile = config.qualityProfiles[0]?.id;
    if (!rootFolder || !qualityProfile) {
      setToast({ text: "No root folder or quality profile configured", ok: false });
      return;
    }

    const id = tab === "movie" ? item.tmdbId : item.tvdbId;
    setAdding(id);
    setToast(null);

    try {
      const body: any = {
        type: tab,
        title: item.title,
        qualityProfileId: qualityProfile,
        rootFolderPath: rootFolder,
      };
      if (tab === "movie") {
        body.tmdbId = item.tmdbId;
        body.year = item.year;
      } else {
        body.tvdbId = item.tvdbId;
        if (config.languageProfiles?.length) {
          body.languageProfileId = config.languageProfiles[0].id;
        }
      }

      const res = await fetch(`${API}/api/media/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setToast({ text: `Added "${data.title}" successfully`, ok: true });
        setResults((prev) =>
          prev.map((r) => {
            const rId = tab === "movie" ? r.tmdbId : r.tvdbId;
            return rId === id ? { ...r, inLibrary: true } : r;
          })
        );
      } else {
        setToast({ text: `Failed: ${data.error}`, ok: false });
      }
    } catch (err) {
      setToast({ text: `Error: ${err}`, ok: false });
    } finally {
      setAdding(null);
    }
  }, [tab, config]);

  const handleBookDownload = useCallback(async (book: AAResult) => {
    setDownloading(book.md5);
    setToast(null);
    try {
      const res = await fetch(`${API}/api/books/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ md5: book.md5 }),
      });
      const data = await res.json();
      if (data.success) {
        setToast({ text: `Added "${book.title}" to Calibre`, ok: true });
      } else {
        setToast({ text: `Failed: ${data.error}`, ok: false });
      }
    } catch (err) {
      setToast({ text: `Error: ${String(err)}`, ok: false });
    } finally {
      setDownloading(null);
    }
  }, []);

  const handleAudiobookDownload = useCallback(async (item: any) => {
    setDownloading(item.guid);
    setToast(null);
    try {
      const res = await fetch(`${API}/api/audiobooks/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ downloadUrl: item.downloadUrl, title: item.title }),
      });
      const data = await res.json();
      if (data.success) {
        setToast({ text: `Sent "${data.name}" to Transmission`, ok: true });
      } else {
        setToast({ text: `Failed: ${data.error}`, ok: false });
      }
    } catch (err) {
      setToast({ text: `Error: ${String(err)}`, ok: false });
    } finally {
      setDownloading(null);
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") search();
  };

  const placeholder: Record<Tab, string> = {
    movie: "Search for movies...",
    tv: "Search for TV shows...",
    books: "Search by title, author, or ISBN...",
    audiobooks: "Search for audiobooks...",
  };

  const hasLibrary = library.length > 0;
  const hasResults = results.length > 0;
  const hasCalibre = calibreResults.length > 0;
  const hasAA = aaResults.length > 0;
  const hasAudiobooks = audiobookResults.length > 0;
  const noResults = !searching && query && !hasLibrary && !hasResults && !hasCalibre && !hasAA && !hasAudiobooks;

  return (
    <div className="book-search-page">
      <div className="bsp-header">
        <button className="bsp-back" onClick={onBack}>
          &larr; Dashboard
        </button>
        <h2>Media Search</h2>
      </div>

      <div className="msp-tabs">
        {(["movie", "tv", "books", "audiobooks"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`msp-tab ${tab === t ? "active" : ""}`}
            onClick={() => switchTab(t)}
          >
            {{ movie: "Movies", tv: "TV Shows", books: "Books", audiobooks: "Audiobooks" }[t]}
          </button>
        ))}
      </div>

      <div className="bsp-search-bar">
        <input
          className="bsp-input"
          type="text"
          placeholder={placeholder[tab]}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        {tab === "books" && (
          <select
            className="bsp-format"
            value={bookFormat}
            onChange={(e) => setBookFormat(e.target.value)}
          >
            <option value="epub">EPUB</option>
            <option value="pdf">PDF</option>
            <option value="">Any format</option>
          </select>
        )}
        <button
          className="bsp-search-btn"
          onClick={search}
          disabled={searching || !query.trim()}
        >
          {searching ? "Searching..." : "Search"}
        </button>
      </div>

      {toast && (
        <div className={`bsp-toast ${toast.ok ? "success" : "error"}`}>
          {toast.text}
        </div>
      )}

      {searching && <div className="bsp-loading">Searching...</div>}
      {noResults && <div className="bsp-empty">No results found for "{query}"</div>}

      {/* Movie/TV results */}
      {isMediaTab && hasLibrary && (
        <div className="bsp-section">
          <h3 className="bsp-section-title">In Your Library</h3>
          <div className="msp-grid">
            {library.map((item: any) => (
              <MediaResultCard
                key={tab === "movie" ? item.tmdbId || item.id : item.tvdbId || item.id}
                item={item}
                type={tab as "movie" | "tv"}
                inLibrary
              />
            ))}
          </div>
        </div>
      )}

      {isMediaTab && hasResults && (
        <div className="bsp-section">
          <h3 className="bsp-section-title">
            {tab === "movie" ? "Radarr Lookup" : "Sonarr Lookup"}
          </h3>
          <div className="msp-grid">
            {results.slice(0, 30).map((item: any) => (
              <MediaResultCard
                key={tab === "movie" ? item.tmdbId : item.tvdbId}
                item={item}
                type={tab as "movie" | "tv"}
                inLibrary={item.inLibrary}
                onAdd={() => handleMediaAdd(item)}
                adding={adding === (tab === "movie" ? item.tmdbId : item.tvdbId)}
                canAdd={!!config}
              />
            ))}
          </div>
        </div>
      )}

      {/* Book results — Calibre library */}
      {tab === "books" && hasCalibre && (
        <div className="bsp-section">
          <h3 className="bsp-section-title">In Your Library</h3>
          <div className="bsp-grid">
            {calibreResults.map((book) => (
              <div key={book.id} className="bsp-card">
                <div className="bsp-card-cover library">
                  <img
                    src={`${API}/api/calibre/cover/${book.id}`}
                    alt=""
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <span className="bsp-badge library">In Library</span>
                </div>
                <div className="bsp-card-info">
                  <div className="bsp-card-title">{book.title}</div>
                  <div className="bsp-card-author">{book.authors?.join(", ")}</div>
                  {book.series && (
                    <div className="bsp-card-meta">{book.series} #{book.series_index || ""}</div>
                  )}
                  <div className="bsp-card-meta">
                    {Object.keys(book.formats || {}).map((f) =>
                      f.split(".").pop()?.toUpperCase()
                    ).join(", ")}
                  </div>
                  {book.tags && book.tags.length > 0 && (
                    <div className="bsp-card-tags">
                      {book.tags.slice(0, 4).map((t) => (
                        <span key={t} className="bsp-tag">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audiobook results — Prowlarr/Transmission */}
      {tab === "audiobooks" && hasAudiobooks && (
        <div className="bsp-section">
          <h3 className="bsp-section-title">Audiobooks</h3>
          <div className="bsp-grid">
            {audiobookResults.slice(0, 20).map((item: any) => (
              <div key={item.guid} className="bsp-card">
                <div className="bsp-card-cover">
                  <div className="bsp-no-cover">Audio</div>
                  <span className="bsp-badge format-m4b">{item.indexer}</span>
                </div>
                <div className="bsp-card-info">
                  <div className="bsp-card-title">{item.title}</div>
                  <div className="bsp-card-meta">
                    {[
                      `${(item.size / (1024 * 1024)).toFixed(0)} MB`,
                      item.seeders !== undefined ? `${item.seeders} seeds` : null,
                    ].filter(Boolean).join(" · ")}
                  </div>
                  <button
                    className="bsp-add-btn"
                    disabled={downloading === item.guid}
                    onClick={() => handleAudiobookDownload(item)}
                  >
                    {downloading === item.guid ? "Sending..." : "Download"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Book results — Anna's Archive */}
      {tab === "books" && hasAA && (
        <div className="bsp-section">
          <h3 className="bsp-section-title">Anna's Archive</h3>
          <div className="bsp-grid">
            {aaResults.slice(0, 20).map((book) => (
              <div key={book.md5} className="bsp-card">
                <div className="bsp-card-cover">
                  {book.coverUrl ? (
                    <img
                      src={book.coverUrl}
                      alt=""
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="bsp-no-cover">{book.fileType.toUpperCase()}</div>
                  )}
                  <span className={`bsp-badge format-${book.fileType}`}>
                    {book.fileType.toUpperCase()}
                  </span>
                </div>
                <div className="bsp-card-info">
                  <div className="bsp-card-title">{book.title}</div>
                  <div className="bsp-card-author">{book.author}</div>
                  <div className="bsp-card-meta">
                    {[book.year, book.fileSize, book.language].filter(Boolean).join(" · ")}
                  </div>
                  {book.publisher && (
                    <div className="bsp-card-meta">{book.publisher}</div>
                  )}
                  <button
                    className="bsp-add-btn"
                    disabled={downloading === book.md5}
                    onClick={() => handleBookDownload(book)}
                  >
                    {downloading === book.md5
                      ? "Adding to Calibre..."
                      : "Add to Calibre"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MediaResultCard({
  item,
  type,
  inLibrary,
  onAdd,
  adding,
  canAdd,
}: {
  item: any;
  type: "movie" | "tv";
  inLibrary?: boolean;
  onAdd?: () => void;
  adding?: boolean;
  canAdd?: boolean;
}) {
  const title = item.title || "Unknown";
  const year = type === "movie" ? item.year : item.year || (item.seasons?.[0]?.statistics?.yearRange);
  const overview = item.overview || "";
  const rating = item.ratings?.value ? `${(item.ratings.value * 10).toFixed(0)}%` : null;
  const poster =
    item.images?.find((i: any) => i.coverType === "poster")?.remoteUrl ||
    item.remotePoster ||
    null;
  const status = item.status;
  const network = item.network;

  return (
    <div className="msp-card">
      <div className="msp-card-poster">
        {poster ? (
          <img
            src={poster}
            alt=""
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="bsp-no-cover">{type === "movie" ? "Movie" : "TV"}</div>
        )}
        {inLibrary && <span className="bsp-badge library">In Library</span>}
      </div>
      <div className="msp-card-info">
        <div className="bsp-card-title">{title}</div>
        <div className="bsp-card-meta">
          {[year, rating, status, network].filter(Boolean).join(" · ")}
        </div>
        {overview && (
          <div className="msp-card-overview">
            {overview.length > 150 ? overview.slice(0, 150) + "..." : overview}
          </div>
        )}
        {!inLibrary && onAdd && canAdd && (
          <button className="bsp-add-btn" disabled={adding} onClick={onAdd}>
            {adding ? "Adding..." : `Add to ${type === "movie" ? "Radarr" : "Sonarr"}`}
          </button>
        )}
      </div>
    </div>
  );
}
