const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { Pool } = require("pg");

const sqlitePath =
  process.env.SQLITE_PATH || path.join(__dirname, "data/users.db");

const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "basic_api",
});

const openSqlite = () => {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(sqlitePath, (err) => {
      if (err) return reject(err);
      resolve(db);
    });
  });
};

const sqliteAll = (db, sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
};

async function ensurePostgresSchema() {
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
}

async function migrate() {
  let sqlite;
  try {
    console.log("🔄 Starting SQLite → PostgreSQL migration...");
    console.log(`📁 SQLite source: ${sqlitePath}`);

    sqlite = await openSqlite();
    await ensurePostgresSchema();

    const users = await sqliteAll(
      sqlite,
      "SELECT id, name, email, password, role, created_at FROM users ORDER BY id ASC",
    );

    console.log(`📦 Found ${users.length} users in SQLite`);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const user of users) {
        await client.query(
          `INSERT INTO users (id, name, email, password, role, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (email) DO UPDATE
           SET name = EXCLUDED.name,
               password = EXCLUDED.password,
               role = EXCLUDED.role,
               created_at = EXCLUDED.created_at`,
          [
            user.id,
            user.name,
            user.email,
            user.password || null,
            user.role || "user",
            user.created_at || new Date().toISOString(),
          ],
        );
      }

      await client.query(
        `SELECT setval(
           pg_get_serial_sequence('users', 'id'),
           COALESCE((SELECT MAX(id) FROM users), 1),
           true
         )`,
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    console.log("✅ Migration completed successfully");
    console.log("💡 You can now run the API against PostgreSQL.");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    process.exitCode = 1;
  } finally {
    if (sqlite) {
      sqlite.close();
    }
    await pool.end();
  }
}

migrate();
