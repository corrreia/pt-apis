import { drizzle } from "drizzle-orm/d1";
import { dbSchema } from "./schema";

export function getDb(env: Env) {
  return drizzle(env.DB, { schema: dbSchema });
}

export type Db = ReturnType<typeof getDb>;
