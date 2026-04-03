import { useRef, useEffect, useMemo } from "react";

interface RecentItem {
  title: string;
  type: string;
  year?: number;
  seriesTitle?: string;
  seasonEpisode?: string;
  addedAt: string;
  thumb?: string;
}

interface Props {
  items: RecentItem[];
}

const SCROLL_SPEED = 0.3;
const CARD_WIDTH = 80;
const CARD_GAP = 10;
const STEP = CARD_WIDTH + CARD_GAP;

// Stable key for an item so we can track identity across renders
function itemKey(item: RecentItem): string {
  return `${item.type}:${item.title}:${item.addedAt}`;
}

export function RecentlyAddedCard({ items }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const offsetRef = useRef(0);
  // Stable buffer: items currently in the DOM as a circular queue
  const bufferRef = useRef<RecentItem[]>([]);
  // The "source" list to pull from (latest props, filtered/sorted)
  const sourceRef = useRef<RecentItem[]>([]);
  // Index into source for next item to append
  const appendIdxRef = useRef(0);
  const countRef = useRef(0);

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = useMemo(() =>
    items
      .filter((item) => new Date(item.addedAt).getTime() > cutoff)
      .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()),
    [items],
  );

  // Update source ref whenever props change — the animation loop will
  // pick up new items next time it recycles a card
  useEffect(() => {
    sourceRef.current = recent;
  }, [recent]);

  // Bootstrap: fill the buffer with enough cards to cover the viewport + overflow
  useEffect(() => {
    if (recent.length === 0 || !wrapperRef.current) return;

    // Only bootstrap once (or if we went from 0 items to some)
    if (bufferRef.current.length > 0) return;

    const wrapperWidth = wrapperRef.current.offsetWidth;
    // Need enough cards to fill 2x the viewport so the wrap is seamless
    const needed = Math.ceil((wrapperWidth * 2) / STEP) + 2;
    const buf: RecentItem[] = [];
    for (let i = 0; i < needed; i++) {
      buf.push(recent[i % recent.length]);
    }
    bufferRef.current = buf;
    appendIdxRef.current = needed % recent.length;
    offsetRef.current = 0;
    countRef.current = needed;
    renderTrack();
  }, [recent.length > 0]);

  function renderTrack() {
    const track = trackRef.current;
    if (!track) return;

    // Rebuild DOM nodes from buffer
    track.innerHTML = "";
    for (const item of bufferRef.current) {
      track.appendChild(createCardNode(item));
    }
  }

  function createCardNode(item: RecentItem): HTMLElement {
    const card = document.createElement("div");
    card.className = "carousel-card";

    if (item.thumb) {
      const img = document.createElement("img");
      img.src = `/api/plex/image${item.thumb}`;
      img.className = "carousel-poster";
      img.loading = "lazy";
      card.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "carousel-poster carousel-poster-placeholder";
      card.appendChild(ph);
    }

    const label = item.type === "movie"
      ? item.title
      : item.seriesTitle || item.title;
    const sub = item.type === "movie"
      ? item.year?.toString()
      : item.seasonEpisode;

    const titleEl = document.createElement("div");
    titleEl.className = "carousel-title";
    titleEl.textContent = label;
    card.appendChild(titleEl);

    if (sub) {
      const subEl = document.createElement("div");
      subEl.className = "carousel-sub";
      subEl.textContent = sub;
      card.appendChild(subEl);
    }

    return card;
  }

  // Animation loop — runs continuously, recycles cards imperatively
  useEffect(() => {
    const animate = () => {
      const track = trackRef.current;
      if (!track || bufferRef.current.length === 0) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      offsetRef.current += SCROLL_SPEED;

      // When we've scrolled past the first card, recycle it:
      // remove from front, append a new one at the back
      if (offsetRef.current >= STEP) {
        offsetRef.current -= STEP;

        // Remove first card from DOM and buffer
        if (track.firstChild) {
          track.removeChild(track.firstChild);
        }
        bufferRef.current.shift();

        // Pick next item from source (circular)
        const source = sourceRef.current;
        if (source.length > 0) {
          const nextItem = source[appendIdxRef.current % source.length];
          appendIdxRef.current = (appendIdxRef.current + 1) % source.length;
          bufferRef.current.push(nextItem);
          track.appendChild(createCardNode(nextItem));
        }
      }

      track.style.transform = `translateX(-${offsetRef.current}px)`;
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Recently Added</span>
        <span className="card-badge badge-muted">
          {recent.length} this week
        </span>
      </div>

      {recent.length === 0 ? (
        <div className="empty-state">Nothing added recently</div>
      ) : (
        <div className="carousel-wrapper" ref={wrapperRef}>
          <div ref={trackRef} className="carousel-track" />
        </div>
      )}
    </div>
  );
}
