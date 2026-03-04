const redisClient = require("../config/redis");
const ApiError = require("../utils/ApiError");
const { sendAlert } = require("../utils/alerting");

/**
 * Global limiter metrics (in-memory)
 */
const limiterMetrics = {
  allowed: 0,
  rejected: 0,
  failClosedRejected: 0,
  redisErrors: 0,
  bypassed: 0,
  slidingWindowChecks: 0,
  tokenBucketChecks: 0,
  redisUnavailableBypass: 0,
  tiers: {},
};

let limiterRedisWasDown = false;

const getClientIp = (req) => {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.ip ||
    "unknown"
  );
};

const recordTier = (tier) => {
  limiterMetrics.tiers[tier] = (limiterMetrics.tiers[tier] || 0) + 1;
};

const getTierLimits = (req, options) => {
  const tierResolver = options.tierResolver || (() => "regular");
  const tier = tierResolver(req) || "regular";
  const tierConfig = options.tiers?.[tier] || options.tiers?.regular || {};

  return {
    tier,
    max: tierConfig.max || options.max || 100,
    windowMs: tierConfig.windowMs || options.windowMs || 15 * 60 * 1000,
    bucketSize: tierConfig.bucketSize || options.bucketSize || 50,
    refillRatePerSec:
      tierConfig.refillRatePerSec || options.refillRatePerSec || 1,
  };
};

const applyHeaders = (
  res,
  { limit, remaining, resetAt, retryAfter, tier, algorithm },
) => {
  res.setHeader("X-RateLimit-Limit", limit);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, remaining));
  res.setHeader("X-RateLimit-Reset", Math.floor(resetAt / 1000));
  res.setHeader("X-RateLimit-Tier", tier);
  res.setHeader("X-RateLimit-Algorithm", algorithm);

  if (retryAfter !== undefined) {
    res.setHeader("Retry-After", Math.max(1, Math.ceil(retryAfter)));
  }
};

const runSlidingWindow = async ({ key, max, windowMs }) => {
  const windowSeconds = Math.max(1, Math.floor(windowMs / 1000));
  const currentCount = await redisClient.incr(key);

  if (currentCount === 1) {
    await redisClient.expire(key, windowSeconds);
  }

  const ttl = await redisClient.ttl(key);
  const safeTtl = ttl > 0 ? ttl : windowSeconds;

  return {
    allowed: currentCount <= max,
    limit: max,
    remaining: max - currentCount,
    resetAt: Date.now() + safeTtl * 1000,
    retryAfter: safeTtl,
    current: currentCount,
  };
};

const runTokenBucket = async ({ key, bucketSize, refillRatePerSec }) => {
  const nowMs = Date.now();

  const script = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local capacity = tonumber(ARGV[2])
    local refillRate = tonumber(ARGV[3])

    local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
    local tokens = tonumber(data[1])
    local lastRefill = tonumber(data[2])

    if not tokens then tokens = capacity end
    if not lastRefill then lastRefill = now end

    local elapsed = math.max(0, now - lastRefill)
    local refill = (elapsed / 1000) * refillRate
    tokens = math.min(capacity, tokens + refill)

    local allowed = 0
    if tokens >= 1 then
      tokens = tokens - 1
      allowed = 1
    end

    redis.call('HSET', key, 'tokens', tokens, 'lastRefill', now)

    local ttl = math.ceil((capacity / refillRate) * 2)
    if ttl < 1 then ttl = 1 end
    redis.call('EXPIRE', key, ttl)

    local retryAfter = 0
    if allowed == 0 then
      retryAfter = math.ceil((1 - tokens) / refillRate)
      if retryAfter < 1 then retryAfter = 1 end
    end

    return { allowed, tokens, ttl, retryAfter }
  `;

  const result = await redisClient.eval(script, {
    keys: [key],
    arguments: [String(nowMs), String(bucketSize), String(refillRatePerSec)],
  });

  const allowed = Number(result[0]) === 1;
  const tokens = Number(result[1]);
  const ttl = Number(result[2]);
  const retryAfter = Number(result[3]);

  return {
    allowed,
    limit: bucketSize,
    remaining: Math.floor(tokens),
    resetAt: Date.now() + ttl * 1000,
    retryAfter,
    current: bucketSize - Math.floor(tokens),
  };
};

/**
 * Advanced Redis-based rate limiter
 * Supports:
 * - sliding-window (simple hard cap)
 * - token-bucket (burst-friendly)
 * - tiered limits by user type
 */
const rateLimiter = (options = {}) => {
  const algorithm = options.algorithm || "sliding-window";
  const namespace = options.namespace || "global";
  const failMode = options.failMode || "open"; // open | closed
  const failClosedStatus = options.failClosedStatus || 503;
  const failClosedMessage =
    options.failClosedMessage ||
    "Rate limiter backend unavailable. Try again shortly.";

  const rejectWhenRedisUnavailable = async () => {
    limiterMetrics.failClosedRejected += 1;
    await sendAlert({
      key: `rate-limiter-fail-closed:${namespace}`,
      level: "error",
      title: "Rate limiter fail-closed block",
      message:
        "Request blocked because Redis is unavailable for a fail-closed limiter",
      details: { namespace, algorithm, failMode },
    });

    throw new ApiError(failClosedStatus, failClosedMessage);
  };

  return async (req, res, next) => {
    try {
      const isRedisReady =
        typeof redisClient.isRedisReady === "function"
          ? redisClient.isRedisReady()
          : redisClient.isOpen;

      if (!isRedisReady) {
        limiterMetrics.redisUnavailableBypass += 1;

        if (!limiterRedisWasDown) {
          limiterRedisWasDown = true;
          await sendAlert({
            key: "rate-limiter-redis-down",
            level: "error",
            title: "Rate limiter failover active",
            message: "Redis unavailable, rate limiter bypassing requests",
            details: { namespace, algorithm },
          });
        }

        if (failMode === "closed") {
          await rejectWhenRedisUnavailable();
          return;
        }

        next();
        return;
      }

      if (limiterRedisWasDown) {
        limiterRedisWasDown = false;
        await sendAlert({
          key: "rate-limiter-redis-recovered",
          level: "warn",
          title: "Rate limiter recovered",
          message: "Redis connection restored for rate limiter",
          details: { namespace, algorithm },
        });
      }

      const ip = getClientIp(req);
      const { tier, max, windowMs, bucketSize, refillRatePerSec } =
        getTierLimits(req, options);
      recordTier(tier);

      const baseKey = `rate_limit:${namespace}:${tier}:${ip}`;

      let outcome;
      if (algorithm === "token-bucket") {
        limiterMetrics.tokenBucketChecks += 1;
        outcome = await runTokenBucket({
          key: baseKey,
          bucketSize,
          refillRatePerSec,
        });
      } else {
        limiterMetrics.slidingWindowChecks += 1;
        outcome = await runSlidingWindow({
          key: baseKey,
          max,
          windowMs,
        });
      }

      applyHeaders(res, {
        limit: outcome.limit,
        remaining: outcome.remaining,
        resetAt: outcome.resetAt,
        retryAfter: outcome.allowed ? undefined : outcome.retryAfter,
        tier,
        algorithm,
      });

      if (!outcome.allowed) {
        limiterMetrics.rejected += 1;
        throw new ApiError(
          429,
          `Rate limit exceeded. Try again in ${Math.ceil(outcome.retryAfter)} seconds.`,
        );
      }

      limiterMetrics.allowed += 1;
      next();
    } catch (error) {
      // If Redis fails, log error and allow request (fail open)
      if (error instanceof ApiError) {
        // Rate limit error - throw it
        throw error;
      } else {
        // Redis connection error - log and continue
        limiterMetrics.redisErrors += 1;
        limiterMetrics.bypassed += 1;
        await sendAlert({
          key: "rate-limiter-redis-error",
          level: "error",
          title: "Rate limiter Redis error",
          message: error.message,
          details: { namespace, algorithm, failMode },
        });
        console.error("Rate limiter Redis error:", error.message);

        if (failMode === "closed") {
          await rejectWhenRedisUnavailable();
          return;
        }

        console.warn("Rate limiter bypassed due to Redis error");
        next();
      }
    }
  };
};

const getRateLimiterMetrics = () => ({
  ...limiterMetrics,
  tiers: { ...limiterMetrics.tiers },
});

const resetRateLimiterMetrics = () => {
  limiterMetrics.allowed = 0;
  limiterMetrics.rejected = 0;
  limiterMetrics.failClosedRejected = 0;
  limiterMetrics.redisErrors = 0;
  limiterMetrics.bypassed = 0;
  limiterMetrics.slidingWindowChecks = 0;
  limiterMetrics.tokenBucketChecks = 0;
  limiterMetrics.redisUnavailableBypass = 0;
  limiterMetrics.tiers = {};
};

module.exports = {
  rateLimiter,
  getRateLimiterMetrics,
  resetRateLimiterMetrics,
};
