import type { Context, Next } from "hono";

/**
 * Rate-limiting middleware backed by Cloudflare Workers native `ratelimits` binding.
 *
 * Uses `cf-connecting-ip` as the default key (standard for public APIs without auth).
 * An optional `keyPrefix` separates rate-limit buckets per route group.
 */
export function rateLimit(opts: {
  binding: "RATE_LIMITER" | "RATE_LIMITER_SEARCH";
  keyPrefix?: string;
}) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const key = opts.keyPrefix ? `${opts.keyPrefix}:${ip}` : ip;

    const { success } = await c.env[opts.binding].limit({ key });

    if (!success) {
      c.header("Retry-After", "60");
      return c.json(
        { error: "Rate limit exceeded. Please slow down.", code: "RATE_LIMITED" },
        429,
      );
    }

    await next();
  };
}
