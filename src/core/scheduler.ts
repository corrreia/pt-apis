import type { CronFrequency } from "./adapter";
import { registry } from "./registry";
import { getDb } from "../db/client";
import {
  createAdapterContext,
  logIngestStart,
  logIngestSuccess,
  logIngestError,
} from "./storage";
import { sources } from "../db/schema";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Cron → frequency mapping
// ---------------------------------------------------------------------------

/**
 * Cloudflare Workers allows max 3 cron triggers. We use:
 *   `* * * * *`   → minutely bucket  (every_minute, every_5_minutes, every_15_minutes)
 *   `0 * * * *`   → hourly bucket    (hourly, every_6_hours)
 *   `0 0 * * *`   → daily bucket     (daily, weekly)
 */
function shouldRun(
  frequency: CronFrequency,
  cron: string,
  minute: number,
  hour: number,
  dayOfWeek: number,
): boolean {
  switch (frequency) {
    // Minutely bucket
    case "every_minute":
      return cron === "* * * * *";
    case "every_5_minutes":
      return cron === "* * * * *" && minute % 5 === 0;
    case "every_15_minutes":
      return cron === "* * * * *" && minute % 15 === 0;

    // Hourly bucket
    case "hourly":
      return cron === "0 * * * *";
    case "every_6_hours":
      return cron === "0 * * * *" && hour % 6 === 0;

    // Daily bucket
    case "daily":
      return cron === "0 0 * * *";
    case "weekly":
      return cron === "0 0 * * *" && dayOfWeek === 0; // Sunday

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Scheduled handler
// ---------------------------------------------------------------------------

export async function handleScheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const db = getDb(env);
  const now = new Date(controller.scheduledTime);
  const minute = now.getUTCMinutes();
  const hour = now.getUTCHours();
  const dayOfWeek = now.getUTCDay();

  for (const adapter of registry.getAll()) {
    for (const schedule of adapter.schedules) {
      if (shouldRun(schedule.frequency, controller.cron, minute, hour, dayOfWeek)) {
        ctx.waitUntil(
          runAdapter(adapter.id, schedule.description, schedule.handler, env, db),
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Run a single adapter schedule with logging
// ---------------------------------------------------------------------------

async function runAdapter(
  adapterId: string,
  description: string,
  handler: (ctx: import("./adapter").AdapterContext) => Promise<void>,
  env: Env,
  db: ReturnType<typeof getDb>,
): Promise<void> {
  const adapterCtx = createAdapterContext(env, db);
  const logId = await logIngestStart(db, adapterId);

  console.log(`[scheduler] Running "${adapterId}" – ${description}`);

  try {
    await handler(adapterCtx);
    await logIngestSuccess(db, logId, 0); // adapters can update count via ctx
    // Update last_fetched_at on the source row
    await db
      .update(sources)
      .set({ lastFetchedAt: new Date() })
      .where(eq(sources.id, adapterId));
    console.log(`[scheduler] ✓ "${adapterId}" completed`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logIngestError(db, logId, message);
    console.error(`[scheduler] ✗ "${adapterId}" failed:`, message);
  }
}
