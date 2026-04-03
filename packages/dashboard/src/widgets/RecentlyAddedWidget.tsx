import { useState, useEffect } from "react";
import { PlexCarousel, type PlexItem } from "./PlexCarousel";

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export function RecentlyAddedWidget() {
  const [items, setItems] = useState<PlexItem[]>([]);

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res = await fetch("/api/plex/status");
        if (!res.ok) return;
        const data = await res.json();
        const cutoff = Date.now() - SEVEN_DAYS;
        setItems(
          (data.recentlyAdded || [])
            .filter((i: PlexItem) => new Date(i.addedAt).getTime() > cutoff)
            .sort((a: PlexItem, b: PlexItem) =>
              new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime(),
            ),
        );
      } catch (err) {
        console.error("Failed to fetch recently added:", err);
      }
    };
    fetch_();
    const interval = setInterval(fetch_, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return <PlexCarousel items={items} header="Recently Added" />;
}
