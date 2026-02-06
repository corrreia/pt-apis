import type { Context, Next } from "hono";

/**
 * KV-based cache middleware.
 *
 * Caches JSON responses in Cloudflare KV with a configurable TTL.
 * The cache key is derived from the full request URL.
 *
 * On HIT: returns cached body with `Cache-Control` and `Vary` headers so
 * browsers / CDN proxies also cache the response.
 */
export function kvCache(opts: { ttlSeconds: number; prefix?: string }) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const key = `${opts.prefix ?? "cache"}:${c.req.url}`;

    // Try to read from cache
    const cached = await c.env.CACHE.get(key, "text");
    if (cached) {
      c.header("X-Cache", "HIT");
      c.header("Content-Type", "application/json");
      c.header("Cache-Control", `public, max-age=${opts.ttlSeconds}`);
      c.header("Vary", "Accept");
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

/**
 * Cache-Control header middleware.
 *
 * Sets `Cache-Control` and `Vary` on successful responses so browsers and
 * CDN proxies can cache without hitting the Worker at all.
 *
 * Use `staleWhileRevalidate` to allow serving stale content while
 * revalidating in the background.
 */
export function cacheControl(maxAge: number, staleWhileRevalidate?: number) {
  return async (c: Context, next: Next) => {
    await next();
    if (c.res.ok) {
      const swr = staleWhileRevalidate
        ? `, stale-while-revalidate=${staleWhileRevalidate}`
        : "";
      c.res.headers.set("Cache-Control", `public, max-age=${maxAge}${swr}`);
      c.res.headers.set("Vary", "Accept");
    }
  };
}
