import type { Context, Next } from "hono";

/**
 * KV-based cache middleware.
 *
 * Caches JSON responses in Cloudflare KV with a configurable TTL.
 * The cache key is derived from the full request URL.
 */
export function kvCache(opts: { ttlSeconds: number; prefix?: string }) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const key = `${opts.prefix ?? "cache"}:${c.req.url}`;

    // Try to read from cache
    const cached = await c.env.CACHE.get(key, "text");
    if (cached) {
      c.header("X-Cache", "HIT");
      c.header("Content-Type", "application/json");
      return c.body(cached);
    }

    // Miss – run handler
    await next();

    // Only cache successful JSON responses
    if (c.res.ok && c.res.headers.get("content-type")?.includes("json")) {
      const body = await c.res.clone().text();
      c.executionCtx.waitUntil(
        c.env.CACHE.put(key, body, { expirationTtl: opts.ttlSeconds }),
      );
      c.header("X-Cache", "MISS");
    }
  };
}
