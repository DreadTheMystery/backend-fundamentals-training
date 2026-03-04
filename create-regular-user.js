const bcrypt = require("bcryptjs");
const { dbRun } = require("./data/database");

async function createRegularUser() {
  try {
    // Hash password
    const hashedPassword = await bcrypt.hash("user123", 10);

    // Insert/update regular user
    await dbRun(
      `INSERT INTO users (name, email, password, role)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name,
           password = EXCLUDED.password,
           role = EXCLUDED.role`,
      ["Regular User", "user@test.com", hashedPassword, "user"],
    );

    console.log("✅ Regular user created successfully!");
    console.log("\n📧 Email: user@test.com");
    console.log("🔑 Password: user123");
    console.log("👤 Role: user (NOT admin)");
    console.log("\nThis user CANNOT delete other users.\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error creating regular user:", error.message);
    process.exit(1);
  }
}

createRegularUser();
