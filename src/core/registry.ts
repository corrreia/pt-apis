import type { AdapterDefinition } from "./adapter";

/**
 * Global adapter registry.
 * Adapters call `registry.register(...)` at import time;
 * the scheduler and API layer read from the registry at runtime.
 */
class AdapterRegistry {
  private adapters = new Map<string, AdapterDefinition>();

  /** Register an adapter. Throws if the id is already taken. */
  register(adapter: AdapterDefinition): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Adapter "${adapter.id}" is already registered.`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  /** Get a single adapter by id. */
  get(id: string): AdapterDefinition | undefined {
    return this.adapters.get(id);
  }

  /** Get all registered adapters. */
  getAll(): AdapterDefinition[] {
    return Array.from(this.adapters.values());
  }

  /** Check whether an adapter id exists. */
  has(id: string): boolean {
    return this.adapters.has(id);
  }

  /** Number of registered adapters. */
  get size(): number {
    return this.adapters.size;
  }
}

/** Singleton registry instance. */
export const registry = new AdapterRegistry();
