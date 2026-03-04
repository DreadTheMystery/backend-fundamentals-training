const express = require("express");
const router = express.Router();
const asyncHandler = require("../utils/asyncHandler");
const redisClient = require("../config/redis");
const {
  validateCreateUser,
  validateUpdateUser,
} = require("../middleware/validateUser");
const { verifyToken, requireAdmin } = require("../middleware/auth");
const { login } = require("../controllers/authController");
const {
  rateLimiter,
  getRateLimiterMetrics,
  resetRateLimiterMetrics,
} = require("../middleware/rateLimiter");
const {
  getHome,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getDbQueryCount,
  resetDbQueryCount,
  getCacheMetrics,
  resetCacheMetrics,
} = require("../controllers/userController");
const { getAlertMetrics, resetAlertMetrics } = require("../utils/alerting");

const resolveTier = (req) => {
  if (req.user?.role === "admin") {
    return "premium";
  }

  if (req.headers["x-api-tier"] === "premium") {
    return "premium";
  }

  return "regular";
};

const usersReadLimiter = rateLimiter({
  namespace: "users-read",
  algorithm: "token-bucket",
  tierResolver: resolveTier,
  tiers: {
    regular: {
      bucketSize: 50,
      refillRatePerSec: 1,
    },
    premium: {
      bucketSize: 150,
      refillRatePerSec: 3,
    },
  },
});

const usersWriteLimiter = rateLimiter({
  namespace: "users-write",
  algorithm: "token-bucket",
  tierResolver: resolveTier,
  tiers: {
    regular: {
      bucketSize: 20,
      refillRatePerSec: 0.4,
    },
    premium: {
      bucketSize: 60,
      refillRatePerSec: 1.5,
    },
  },
});

const loginLimiter = rateLimiter({
  namespace: "auth-login",
  algorithm: "sliding-window",
  failMode: "closed",
  failClosedStatus: 503,
  failClosedMessage:
    "Login temporarily unavailable due to rate limiter backend issue. Please retry shortly.",
  tierResolver: resolveTier,
  tiers: {
    regular: {
      max: 10,
      windowMs: 15 * 60 * 1000,
    },
    premium: {
      max: 30,
      windowMs: 15 * 60 * 1000,
    },
  },
});

// Public routes
// GET / → returns plain text
router.get("/", asyncHandler(getHome));

// GET /stats → DB query statistics (for testing/monitoring)
router.get("/stats", (req, res) => {
  const limiterStats = getRateLimiterMetrics();
  const redisHealth =
    typeof redisClient.getRedisHealth === "function"
      ? redisClient.getRedisHealth()
      : { isOpen: redisClient.isOpen };

  res.json({
    success: true,
    dbQueries: getDbQueryCount(),
    cache: getCacheMetrics(),
    limiter: limiterStats,
    redis: redisHealth,
    alerts: getAlertMetrics(),
    message: "DB/cache/limiter metrics",
  });
});

// POST /stats/reset → Reset DB query counter (for testing)
router.post("/stats/reset", (req, res) => {
  const prevCount = resetDbQueryCount();
  resetCacheMetrics();
  resetRateLimiterMetrics();
  resetAlertMetrics();

  res.json({
    success: true,
    previousCount: prevCount,
    currentCount: 0,
    message: "Metrics reset (DB + limiter)",
  });
});

// POST /login → authenticate user
router.post("/login", asyncHandler(loginLimiter), asyncHandler(login));

// GET /users → Aggressive rate limit + cache stampede protection
// This endpoint combines:
// 1. Rate limiter (50 req/min per IP) - prevents abuse
// 2. Cache with stampede prevention - protects DB from bursts
router.get("/users", asyncHandler(usersReadLimiter), asyncHandler(getUsers));

// Protected routes (require authentication)
// POST /users → accepts JSON body and stores in memory
router.post(
  "/users",
  asyncHandler(verifyToken),
  asyncHandler(usersWriteLimiter),
  asyncHandler(validateCreateUser),
  asyncHandler(createUser),
);

// PUT /users/:id → updates user
router.put(
  "/users/:id",
  asyncHandler(verifyToken),
  asyncHandler(usersWriteLimiter),
  asyncHandler(validateUpdateUser),
  asyncHandler(updateUser),
);

// DELETE /users/:id → deletes user (ADMIN ONLY)
router.delete(
  "/users/:id",
  asyncHandler(verifyToken),
  asyncHandler(usersWriteLimiter),
  asyncHandler(requireAdmin),
  asyncHandler(deleteUser),
);

module.exports = router;
