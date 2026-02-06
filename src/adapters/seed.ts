import { registry } from "../core/registry";
import { getDb } from "../db/client";
import { sources } from "../db/schema";

/**
 * Ensure every registered adapter has a corresponding row in the `sources` table.
 * Called once on app startup (first fetch request).
 */
export async function seedSources(env: Env): Promise<void> {
  const db = getDb(env);

  for (const adapter of registry.getAll()) {
    await db
      .insert(sources)
      .values({
        id: adapter.id,
        name: adapter.name,
        description: adapter.description,
        sourceUrl: adapter.sourceUrl,
        dataTypes: JSON.stringify(adapter.dataTypes),
        status: "active",
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: sources.id,
        set: {
          name: adapter.name,
          description: adapter.description,
          sourceUrl: adapter.sourceUrl,
          dataTypes: JSON.stringify(adapter.dataTypes),
        },
      });
  }
}
