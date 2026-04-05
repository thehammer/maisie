/**
 * DynamicCard — auto-renders any plugin action output using the widget catalog.
 *
 * When a card ID doesn't match a hand-written component, App falls back here.
 * DynamicCard fetches its own data and delegates to ResourceCard or ResourceList
 * based on whether the response is an object or array.
 */

import { useApi } from "../hooks/useApi";
import { ResourceCard, ResourceList, type ResourceFieldDef } from "./ResourceCard";
import type { MaisieFieldType } from "@maisie/shared";

// Mirrors plugin-core's CardDescriptor — defined locally since the dashboard
// only depends on @maisie/shared, not @maisie/plugin-core.
export interface CardDescriptor {
  id: string;           // "{pluginName}.{actionName}"
  pluginName: string;
  actionName: string;
  label: string;
  section: string;
  outputFields: Array<{
    key: string;
    type: "string" | "number" | "boolean" | "array" | "object" | "unknown";
    maisieType: MaisieFieldType | null;
    label: string;
    optional: boolean;
  }>;
}

interface DynamicCardProps {
  descriptor: CardDescriptor;
  pollInterval?: number;
}

/** Last-resort mapping when no maisieType annotation is present. */
function fallbackMaisieType(type: CardDescriptor["outputFields"][number]["type"]): MaisieFieldType | null {
  switch (type) {
    case "boolean": return "boolean";
    case "object":  return "json";
    default:        return null;
  }
}

// Mirrors deriveHttpPath() in plugin-core/registry.ts — strips verb prefix,
// replaces underscores with hyphens to match the actual HTTP route.
const VERB_PREFIXES = ["list_", "get_", "set_", "create_", "delete_", "invoke_", "stream_", "subscribe_"];

function deriveApiPath(actionName: string): string {
  let name = actionName;
  for (const prefix of VERB_PREFIXES) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }
  return "/" + name.replace(/_/g, "-");
}

export function DynamicCard({ descriptor, pollInterval = 30_000 }: DynamicCardProps) {
  const url = `/api/${descriptor.pluginName}${deriveApiPath(descriptor.actionName)}`;
  const { data, loading, error } = useApi<unknown>(url, pollInterval);

  // Prefer the semantic maisieType from the catalog (Phase 2); fall back to
  // the raw Zod type mapping for fields that have no annotation.
  const fields: ResourceFieldDef[] = descriptor.outputFields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.maisieType ?? fallbackMaisieType(f.type),
  }));

  const errorMsg = error ? String(error) : null;

  if (Array.isArray(data)) {
    return (
      <ResourceList
        title={descriptor.label}
        items={data as Record<string, unknown>[]}
        fields={fields}
        loading={loading}
        error={errorMsg}
      />
    );
  }

  return (
    <ResourceCard
      title={descriptor.label}
      data={data as Record<string, unknown> | null}
      fields={fields}
      loading={loading}
      error={errorMsg}
    />
  );
}
