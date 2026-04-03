import { useState, useEffect, useCallback } from "react";

export function useApi<T>(url: string | null, interval?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(url !== null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (url === null) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    let mounted = true;

    async function fetchData() {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();
        if (mounted) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(String(err));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchData();

    if (interval) {
      const id = setInterval(fetchData, interval);
      return () => { mounted = false; clearInterval(id); };
    }

    return () => { mounted = false; };
  }, [url, interval, tick]);

  return { data, error, loading, refresh };
}
