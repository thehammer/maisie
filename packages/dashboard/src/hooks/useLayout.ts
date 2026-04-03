import { useState, useCallback, useEffect } from "react";

export interface WidgetDescriptor {
  id: string;
  pluginName: string;
  actionName: string;
  label: string;
  section: string;
  outputFields: Array<{ key: string; type: string; label: string; optional: boolean }>;
}

export interface WidgetPlacement {
  widgetId: string;
  position: { row: number; col: number };
  size: { rows: number; cols: number };
  config: {
    visibleFields: string[];
    refreshInterval?: number;
    title?: string;
  };
}

interface LayoutState {
  widgets: WidgetPlacement[];
  catalog: WidgetDescriptor[];
  isCustomizing: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

export function useLayout(page: string) {
  const [state, setState] = useState<LayoutState>({
    widgets: [],
    catalog: [],
    isCustomizing: false,
    loading: true,
    saving: false,
    error: null,
  });
  // Keep a snapshot for cancel
  const [savedWidgets, setSavedWidgets] = useState<WidgetPlacement[]>([]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const [layoutRes, catalogRes] = await Promise.all([
          fetch(`/api/layout/${page}`),
          fetch("/api/widgets/catalog"),
        ]);

        const layout = layoutRes.ok ? await layoutRes.json() : { widgets: [] };
        const catalogData = catalogRes.ok ? await catalogRes.json() : { widgets: [] };

        if (mounted) {
          setState((s) => ({
            ...s,
            widgets: layout.widgets ?? [],
            catalog: catalogData.widgets ?? [],
            loading: false,
          }));
          setSavedWidgets(layout.widgets ?? []);
        }
      } catch (err) {
        if (mounted) {
          setState((s) => ({ ...s, loading: false, error: String(err) }));
        }
      }
    }

    load();
    return () => { mounted = false; };
  }, [page]);

  const saveLayout = useCallback(
    async (widgets: WidgetPlacement[]) => {
      setState((s) => ({ ...s, saving: true, error: null }));
      try {
        const res = await fetch(`/api/layout/${page}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page, widgets }),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        setSavedWidgets(widgets);
        setState((s) => ({ ...s, saving: false, isCustomizing: false }));
      } catch (err) {
        setState((s) => ({ ...s, saving: false, error: String(err) }));
      }
    },
    [page],
  );

  const toggleCustomize = useCallback(() => {
    setState((s) => {
      if (s.isCustomizing) {
        // Cancel — restore snapshot
        return { ...s, isCustomizing: false, widgets: savedWidgets };
      }
      return { ...s, isCustomizing: true };
    });
  }, [savedWidgets]);

  const addWidget = useCallback((descriptor: WidgetDescriptor) => {
    setState((s) => {
      const maxRow = s.widgets.reduce((m, w) => Math.max(m, w.position.row + w.size.rows), 0);
      const placement: WidgetPlacement = {
        widgetId: descriptor.id,
        position: { row: maxRow, col: 0 },
        size: { rows: 1, cols: 1 },
        config: {
          visibleFields: descriptor.outputFields.filter((f) => !f.optional).map((f) => f.key),
        },
      };
      return { ...s, widgets: [...s.widgets, placement] };
    });
  }, []);

  const removeWidget = useCallback((widgetId: string) => {
    setState((s) => ({ ...s, widgets: s.widgets.filter((w) => w.widgetId !== widgetId) }));
  }, []);

  const configureWidget = useCallback(
    (widgetId: string, config: Partial<WidgetPlacement["config"]>) => {
      setState((s) => ({
        ...s,
        widgets: s.widgets.map((w) =>
          w.widgetId === widgetId ? { ...w, config: { ...w.config, ...config } } : w,
        ),
      }));
    },
    [],
  );

  const moveWidget = useCallback((widgetId: string, direction: "up" | "down") => {
    setState((s) => {
      const idx = s.widgets.findIndex((w) => w.widgetId === widgetId);
      if (idx === -1) return s;
      const next = direction === "up" ? idx - 1 : idx + 1;
      if (next < 0 || next >= s.widgets.length) return s;
      const arr = [...s.widgets];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return { ...s, widgets: arr };
    });
  }, []);

  return {
    widgets: state.widgets,
    catalog: state.catalog,
    isCustomizing: state.isCustomizing,
    loading: state.loading,
    saving: state.saving,
    error: state.error,
    toggleCustomize,
    saveLayout: () => saveLayout(state.widgets),
    addWidget,
    removeWidget,
    configureWidget,
    moveWidget,
  };
}
