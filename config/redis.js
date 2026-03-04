const redis = require("redis");

const redisHealth = {
  status: "connecting",
  lastConnectedAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
  reconnectAttempts: 0,
  totalErrors: 0,
};

let ready = false;

// Create Redis client
const redisClient = redis.createClient({
  socket: {
    host: "localhost",
    port: 6379,
    reconnectStrategy: (retries) => {
      redisHealth.reconnectAttempts = retries;
      // Exponential backoff up to 3 seconds
      return Math.min(3000, 100 * 2 ** retries);
    },
  },
});

// Error handling
redisClient.on("error", (err) => {
  ready = false;
  redisHealth.status = "error";
  redisHealth.lastErrorAt = new Date().toISOString();
  redisHealth.lastErrorMessage = err.message;
  redisHealth.totalErrors += 1;
  console.error("❌ Redis Client Error:", err);
});

// Connection confirmation
redisClient.on("connect", () => {
  console.log("✅ Connected to Redis");
});

redisClient.on("ready", () => {
  ready = true;
  redisHealth.status = "ready";
  redisHealth.lastConnectedAt = new Date().toISOString();
});

redisClient.on("reconnecting", () => {
  ready = false;
  redisHealth.status = "reconnecting";
});

redisClient.on("end", () => {
  ready = false;
  redisHealth.status = "ended";
});

// Initialize connection
(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    ready = false;
    redisHealth.status = "degraded";
    redisHealth.lastErrorAt = new Date().toISOString();
    redisHealth.lastErrorMessage = err.message;
    console.error("Failed to connect to Redis:", err.message);
    console.log("⚠️  Server will continue without caching");
  }
})();

redisClient.isRedisReady = () => ready && redisClient.isOpen;
redisClient.getRedisHealth = () => ({
  ...redisHealth,
  isOpen: redisClient.isOpen,
  isReady: redisClient.isRedisReady(),
});

module.exports = redisClient;
