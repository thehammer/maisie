import type { CalibreStatus } from "@maisie/shared";

interface Props {
  status: CalibreStatus;
}

export function CalibreCard({ status }: Props) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Calibre</span>
        <span className="card-badge badge-muted">
          {status.totalBooks} books
        </span>
      </div>

      {status.libraries.map((lib) => (
        <div key={lib.id} className="stat-row">
          <span className="stat-label">{lib.name}</span>
          <span className="stat-value">{lib.bookCount} books</span>
        </div>
      ))}

      <div className="stat-row">
        <span className="stat-label">Authors</span>
        <span className="stat-value">{status.totalAuthors}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Tags</span>
        <span className="stat-value">{status.totalTags}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Formats</span>
        <span className="stat-value">
          {Object.entries(status.formats)
            .sort(([, a], [, b]) => b - a)
            .map(([fmt, count]) => `${fmt.toUpperCase()} (${count})`)
            .join(", ")}
        </span>
      </div>

      {status.recentlyAdded.length > 0 && (
        <>
          <div className="card-divider" />
          <div className="card-section-title">Recently Added</div>
          {status.recentlyAdded.slice(0, 5).map((book) => (
            <div key={book.id} className="list-item">
              <div className="list-item-text">
                <div className="list-item-title">{book.title}</div>
                <div className="list-item-sub">{book.authors.join(", ")}</div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
