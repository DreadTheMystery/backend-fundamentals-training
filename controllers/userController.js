const ApiError = require("../utils/ApiError");
const { dbRun, dbAll, dbGet } = require("../data/database");
const redisClient = require("../config/redis");
const { sendAlert } = require("../utils/alerting");

// Cache versioning for safe invalidation
let USERS_CACHE_VERSION = 1;

// DB query counter for monitoring
let DB_QUERY_COUNT = 0;

// Cache metrics
const CACHE_METRICS = {
  redisHits: 0,
  redisMisses: 0,
  hitAfterWait: 0,
  fallbacks: 0,
  rebuilds: 0,
  redisUnavailableBypass: 0,
};

let cacheRedisWasDown = false;

const getUsersCacheKey = () => `users:all:v${USERS_CACHE_VERSION}`;

const incrementCacheVersion = () => {
  USERS_CACHE_VERSION++;
  console.log(`Cache version bumped to v${USERS_CACHE_VERSION}`);
};

const getDbQueryCount = () => DB_QUERY_COUNT;

const resetDbQueryCount = () => {
  const count = DB_QUERY_COUNT;
  DB_QUERY_COUNT = 0;
  return count;
};

const getCacheMetrics = () => ({ ...CACHE_METRICS });

const resetCacheMetrics = () => {
  CACHE_METRICS.redisHits = 0;
  CACHE_METRICS.redisMisses = 0;
  CACHE_METRICS.hitAfterWait = 0;
  CACHE_METRICS.fallbacks = 0;
  CACHE_METRICS.rebuilds = 0;
  CACHE_METRICS.redisUnavailableBypass = 0;
};

// GET / → returns plain text
const getHome = (req, res) => {
  res.status(200).send("Welcome to the Express API Server");
};

// GET /users → SELECT * FROM users (with Redis caching + cache stampede prevention)
const getUsers = async (req, res) => {
  const CACHE_KEY = getUsersCacheKey();
  const LOCK_KEY = `lock:${CACHE_KEY}`;
  const TTL = 60; // 60 seconds
  const LOCK_TTL = 5; // 5 seconds lock timeout

  const isRedisReady =
    typeof redisClient.isRedisReady === "function"
      ? redisClient.isRedisReady()
      : redisClient.isOpen;

  if (!isRedisReady) {
    CACHE_METRICS.redisUnavailableBypass += 1;
    DB_QUERY_COUNT += 1;

    if (!cacheRedisWasDown) {
      cacheRedisWasDown = true;
      await sendAlert({
        key: "cache-redis-down",
        level: "error",
        title: "Cache failover active",
        message: "Redis unavailable, /users is reading directly from SQLite",
        details: { endpoint: "/users" },
      });
    }

    const users = await dbAll("SELECT * FROM users ORDER BY id DESC");
    res.setHeader("X-Cache", "BYPASS-REDIS-DOWN");
    res.setHeader("X-Total-Users", users.length);
    res.setHeader("X-Powered-By-Custom", "Express-API-v1.0");

    return res.status(200).json({
      success: true,
      count: users.length,
      data: users,
    });
  }

  if (cacheRedisWasDown) {
    cacheRedisWasDown = false;
    await sendAlert({
      key: "cache-redis-recovered",
      level: "warn",
      title: "Cache Redis recovered",
      message: "Redis connection restored for /users cache",
      details: { endpoint: "/users" },
    });
  }

  try {
    // Step 1: Check Redis cache
    const cachedData = await redisClient.get(CACHE_KEY);

    if (cachedData) {
      // Cache hit - return parsed data
      const users = JSON.parse(cachedData);
      CACHE_METRICS.redisHits += 1;

      res.setHeader("X-Cache", "HIT");
      res.setHeader("X-Total-Users", users.length);
      res.setHeader("X-Powered-By-Custom", "Express-API-v1.0");

      return res.status(200).json({
        success: true,
        count: users.length,
        data: users,
      });
    }
  } catch (redisErr) {
    // Redis error - log and continue to DB
    console.error("Redis GET error:", redisErr.message);
  }

  // Step 2: Cache miss - attempt to acquire lock
  CACHE_METRICS.redisMisses += 1;
  let lockAcquired = false;
  try {
    // SET NX = Set if Not eXists (atomic operation)
    const result = await redisClient.set(LOCK_KEY, "1", {
      NX: true,
      EX: LOCK_TTL,
    });
    lockAcquired = result === "OK";
  } catch (redisErr) {
    console.error("Redis LOCK error:", redisErr.message);
  }

  if (lockAcquired) {
    // Step 3: Lock acquired - rebuild cache
    try {
      DB_QUERY_COUNT++; // Track DB query
      console.log(`🔍 DB Query #${DB_QUERY_COUNT}: Rebuilding cache`);
      CACHE_METRICS.rebuilds += 1;
      const users = await dbAll("SELECT * FROM users ORDER BY id DESC");

      // Store in Redis with TTL
      try {
        await redisClient.set(CACHE_KEY, JSON.stringify(users), { EX: TTL });
      } catch (redisErr) {
        console.error("Redis SET error:", redisErr.message);
      }

      // Release lock
      try {
        await redisClient.del(LOCK_KEY);
      } catch (redisErr) {
        console.error("Redis DEL LOCK error:", redisErr.message);
      }

      res.setHeader("X-Cache", "MISS-REBUILD");
      res.setHeader("X-Total-Users", users.length);
      res.setHeader("X-Powered-By-Custom", "Express-API-v1.0");

      return res.status(200).json({
        success: true,
        count: users.length,
        data: users,
      });
    } catch (err) {
      // Release lock on error
      try {
        await redisClient.del(LOCK_KEY);
      } catch (redisErr) {
        console.error("Redis DEL LOCK error:", redisErr.message);
      }
      throw err;
    }
  } else {
    // Step 4: Lock NOT acquired - sleep and retry cache once
    await new Promise((resolve) => setTimeout(resolve, 50)); // 50ms wait

    try {
      const cachedData = await redisClient.get(CACHE_KEY);

      if (cachedData) {
        // Cache now available (another request rebuilt it)
        const users = JSON.parse(cachedData);
        CACHE_METRICS.hitAfterWait += 1;

        res.setHeader("X-Cache", "HIT-AFTER-WAIT");
        res.setHeader("X-Total-Users", users.length);
        res.setHeader("X-Powered-By-Custom", "Express-API-v1.0");

        return res.status(200).json({
          success: true,
          count: users.length,
          data: users,
        });
      }
    } catch (redisErr) {
      console.error("Redis GET retry error:", redisErr.message);
    }

    // Fallback: Query DB if cache still not available
    DB_QUERY_COUNT++; // Track DB query
    console.log(`🔍 DB Query #${DB_QUERY_COUNT}: Fallback query`);
    CACHE_METRICS.fallbacks += 1;
    const users = await dbAll("SELECT * FROM users ORDER BY id DESC");

    // Attempt to set cache (without lock) - helps if lock-holder crashed
    try {
      await redisClient.set(CACHE_KEY, JSON.stringify(users), { EX: TTL });
    } catch (redisErr) {
      console.error("Redis SET fallback error:", redisErr.message);
    }

    res.setHeader("X-Cache", "MISS-FALLBACK");
    res.setHeader("X-Total-Users", users.length);
    res.setHeader("X-Powered-By-Custom", "Express-API-v1.0");

    res.status(200).json({
      success: true,
      count: users.length,
      data: users,
    });
  }
};

// POST /users → INSERT INTO users(...)
const createUser = async (req, res) => {
  const { name, email } = req.body;

  // Check if email already exists
  const existingUser = await dbGet("SELECT * FROM users WHERE email = ?", [
    email,
  ]);
  if (existingUser) {
    throw new ApiError(400, "User with this email already exists");
  }

  // Insert new user
  const result = await dbRun("INSERT INTO users (name, email) VALUES (?, ?)", [
    name,
    email,
  ]);

  const newUser = await dbGet("SELECT * FROM users WHERE id = ?", [result.id]);

  // Invalidate cache by bumping version (no DEL operation needed)
  incrementCacheVersion();

  res.status(201).json({
    success: true,
    message: "User created successfully",
    data: newUser,
  });
};

// PUT /users/:id → UPDATE users SET ...
const updateUser = async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, email } = req.body;

  // Find user
  const user = await dbGet("SELECT * FROM users WHERE id = ?", [id]);

  if (!user) {
    throw new ApiError(404, `User with id ${id} not found`);
  }

  // Check if email already exists (for other users)
  if (email && email !== user.email) {
    const existingUser = await dbGet("SELECT * FROM users WHERE email = ?", [
      email,
    ]);
    if (existingUser) {
      throw new ApiError(400, "Email already in use by another user");
    }
  }

  // Update user
  const updateName = name || user.name;
  const updateEmail = email || user.email;

  await dbRun("UPDATE users SET name = ?, email = ? WHERE id = ?", [
    updateName,
    updateEmail,
    id,
  ]);

  const updatedUser = await dbGet("SELECT * FROM users WHERE id = ?", [id]);

  // Invalidate cache by bumping version (no DEL operation needed)
  incrementCacheVersion();

  res.status(200).json({
    success: true,
    message: "User updated successfully",
    data: updatedUser,
  });
};

// DELETE /users/:id → DELETE FROM users WHERE id=?
const deleteUser = async (req, res) => {
  const id = parseInt(req.params.id);

  // Find user
  const user = await dbGet("SELECT * FROM users WHERE id = ?", [id]);

  if (!user) {
    throw new ApiError(404, `User with id ${id} not found`);
  }

  // Delete user
  await dbRun("DELETE FROM users WHERE id = ?", [id]);

  // Invalidate cache by bumping version (no DEL operation needed)
  incrementCacheVersion();

  res.status(200).json({
    success: true,
    message: "User deleted successfully",
    data: user,
  });
};

module.exports = {
  getHome,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getDbQueryCount,
  resetDbQueryCount,
  getCacheMetrics,
  resetCacheMetrics,
};
