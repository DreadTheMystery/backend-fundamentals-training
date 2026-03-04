const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "basic_api",
  max: Number(process.env.PGPOOL_MAX || 10),
});

pool.on("error", (err) => {
  console.error("❌ PostgreSQL pool error:", err.message);
});

const convertPlaceholders = (sql) => {
  let index = 0;
  return sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
};

const normalizeSql = (sql) => sql.replace(/\s+/g, " ").trim().toLowerCase();

const ensureInsertReturningId = (sql) => {
  const normalized = normalizeSql(sql);
  if (!normalized.startsWith("insert")) {
    return sql;
  }

  if (normalized.includes(" returning ")) {
    return sql;
  }

  return `${sql} RETURNING id`;
};

const initializeDatabase = async () => {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Connected to PostgreSQL database");

    await pool.query(
      `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
    );

    console.log("✅ Users table ready (PostgreSQL)");
  } catch (err) {
    console.error("❌ Database connection/setup error:", err.message);
  }
};

initializeDatabase();

const dbRun = async (sql, params = []) => {
  const withReturning = ensureInsertReturningId(sql);
  const pgSql = convertPlaceholders(withReturning);
  const result = await pool.query(pgSql, params);

  return {
    id: result.rows?.[0]?.id,
    changes: result.rowCount,
  };
};

const dbAll = async (sql, params = []) => {
  const pgSql = convertPlaceholders(sql);
  const result = await pool.query(pgSql, params);
  return result.rows;
};

const dbGet = async (sql, params = []) => {
  const pgSql = convertPlaceholders(sql);
  const result = await pool.query(pgSql, params);
  return result.rows[0] || null;
};

module.exports = {
  db: pool,
  dbRun,
  dbAll,
  dbGet,
};
