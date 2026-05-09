/**
 * EntityRegistry — the catalog of named entities available in the Maisie platform.
 *
 * An entity groups related data fields under a logical name (e.g. "services", "catalog").
 * Each field points to a data source via an actionName. For sentinel entities the
 * actionName starts with "__" and is dispatched directly by the AddressResolver without
 * going through a plugin action.
 *
 * Three-layer model:
 *   entity.field → ActionName → AddressResolver → HTTP endpoint / plugin action
 */

export interface EntityFieldDef {
  kind: "data";
  /** Shape of the returned value */
  type: "collection" | "record" | "scalar";
  /**
   * Sentinel action name (starts with __) or plugin action name.
   * The AddressResolver maps this to a concrete data provider.
   */
  actionName: string;
}

export interface EntityDef {
  name: string;
  description: string;
  source: "plugin" | "sentinel";
  pluginName?: string;
  section?: string;
  fields: Record<string, EntityFieldDef>;
}

export class EntityRegistry {
  private entities = new Map<string, EntityDef>();

  constructor() {
    // Built-in sentinel entities registered at construction time.
    // Plugin entities are registered via register() during plugin init.

    const servicesEntity: EntityDef = {
      name: "services",
      description: "Health status of all connected services",
      source: "sentinel",
      section: "system",
      fields: {
        status: {
          kind: "data",
          type: "collection",
          actionName: "__services_status",
        },
      },
    };
    this.entities.set("services", servicesEntity);
  }

  /** Register an entity (called by plugins during init) */
  register(entity: EntityDef): void {
    this.entities.set(entity.name, entity);
  }

  get(name: string): EntityDef | undefined {
    return this.entities.get(name);
  }

  getAll(): EntityDef[] {
    return [...this.entities.values()];
  }
}

/** Singleton registry — used by the AddressResolver and view system */
export const entityRegistry = new EntityRegistry();
