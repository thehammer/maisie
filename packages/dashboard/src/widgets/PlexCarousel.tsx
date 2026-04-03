import { useRef, useEffect, useCallback } from "react";

export interface PlexItem {
  title: string;
  type: string;
  year?: number;
  seriesTitle?: string;
  seasonEpisode?: string;
  addedAt: string;
  thumb?: string;
}

const SCROLL_SPEED = 0.4;
const CARD_WIDTH = 90;
const CARD_GAP = 14;

interface PlexCarouselProps {
  items: PlexItem[];
  header: string;
}

export function PlexCarousel({ items, header }: PlexCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const rafRef = useRef<number>(0);

  const animate = useCallback(() => {
    if (!scrollRef.current || items.length === 0) {
      rafRef.current = requestAnimationFrame(animate);
      return;
    }

    offsetRef.current += SCROLL_SPEED;
    const setWidth = items.length * (CARD_WIDTH + CARD_GAP);
    if (offsetRef.current >= setWidth) {
      offsetRef.current -= setWidth;
    }

    scrollRef.current.style.transform = `translateX(-${offsetRef.current}px)`;
    rafRef.current = requestAnimationFrame(animate);
  }, [items.length]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animate]);

  if (items.length === 0) return null;

  const renderCard = (item: PlexItem, i: number) => {
    const label = item.type === "movie"
      ? item.title
      : item.seriesTitle || item.title;
    const sub = item.type === "movie"
      ? item.year?.toString()
      : item.seasonEpisode;

    return (
      <div key={i} style={styles.card}>
        {item.thumb ? (
          <img
            src={`/api/plex/image${item.thumb}`}
            alt={label}
            style={styles.poster}
            loading="lazy"
          />
        ) : (
          <div style={styles.posterPlaceholder} />
        )}
        <div style={styles.info}>
          <div style={styles.title}>{label}</div>
          {sub && <div style={styles.sub}>{sub}</div>}
        </div>
      </div>
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>{header}</div>
      <div style={styles.scrollWrapper}>
        <div ref={scrollRef} style={styles.grid}>
          {items.map((m, i) => renderCard(m, i))}
          {items.map((m, i) => renderCard(m, i + items.length))}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    color: "white",
    padding: "16px 24px",
    height: "100vh",
    boxSizing: "border-box",
    overflow: "hidden",
    background: "rgba(30,30,30,0.20)",
    borderRadius: "4px",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    fontSize: "18px",
    fontWeight: 700,
    letterSpacing: "-0.2px",
    textShadow: "0 2px 6px rgba(0,0,0,0.7)",
    marginBottom: "12px",
    flexShrink: 0,
  },
  scrollWrapper: {
    flex: 1,
    overflow: "hidden",
    position: "relative",
  },
  grid: {
    display: "flex",
    gap: `${CARD_GAP}px`,
    position: "absolute",
    top: 0,
    left: 0,
    willChange: "transform",
  },
  card: {
    flexShrink: 0,
    width: `${CARD_WIDTH}px`,
    display: "flex",
    flexDirection: "column",
    gap: "5px",
  },
  poster: {
    width: `${CARD_WIDTH}px`,
    height: "135px",
    objectFit: "cover",
    borderRadius: "2px",
    boxShadow: "0 3px 12px rgba(0,0,0,0.5)",
  },
  posterPlaceholder: {
    width: `${CARD_WIDTH}px`,
    height: "135px",
    borderRadius: "2px",
    background: "rgba(255,255,255,0.08)",
  },
  info: {
    display: "flex",
    flexDirection: "column",
    gap: "1px",
  },
  title: {
    fontSize: "11px",
    fontWeight: 600,
    textShadow: "0 1px 3px rgba(0,0,0,0.6)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  sub: {
    fontSize: "10px",
    fontWeight: 500,
    color: "rgba(255,255,255,0.5)",
    textShadow: "0 1px 2px rgba(0,0,0,0.5)",
  },
};
