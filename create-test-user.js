const bcrypt = require("bcryptjs");
const { dbRun } = require("./data/database");

async function createTestUser() {
  try {
    // Hash password
    const hashedPassword = await bcrypt.hash("password123", 10);

    // Insert/update test admin user
    await dbRun(
      `INSERT INTO users (name, email, password, role)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name,
           password = EXCLUDED.password,
           role = EXCLUDED.role`,
      ["Admin User", "admin@example.com", hashedPassword, "admin"],
    );

    console.log("✅ Test admin user created successfully!");
    console.log("\n📧 Email: admin@example.com");
    console.log("🔑 Password: password123");
    console.log("👑 Role: admin");
    console.log(
      "\nUse these credentials to login and get a JWT token with admin privileges.\n",
    );

    process.exit(0);
  } catch (error) {
    console.error("❌ Error creating test user:", error.message);
    process.exit(1);
  }
}

createTestUser();
