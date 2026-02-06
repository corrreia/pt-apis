import { readdirSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

function getLocalD1DB(): string | undefined {
  try {
    const basePath = path.resolve(".wrangler/state/v3/d1");
    const dbFile = readdirSync(basePath, {
      encoding: "utf-8",
      recursive: true,
    }).find((f) => f.endsWith(".sqlite"));

    if (!dbFile) {
      throw new Error(
        ".sqlite file not found. Run 'wrangler dev' first to create the local D1 database."
      );
    }

    const url = path.resolve(basePath, dbFile);
    console.log("Found local D1 DB at", url);
    return url;
  } catch (e) {
    console.error("Error:", e);
    return undefined;
  }
}

export default defineConfig({
  // Core schema + any adapter-specific schemas (adapters can add their own tables)
  schema: ["./src/db/schema.ts", "./src/adapters/*/schema.ts"],
  out: "./migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: getLocalD1DB() ?? "",
  },
});
