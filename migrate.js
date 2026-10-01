// Usage:
//   npm run migrate          apply all pending migrations
//   npm run migrate:status   list applied / pending
//   npm run seed             insert sample data (see seed.js)
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const DIR = path.join(__dirname, "migrations");
const cmd = process.argv[2] || "up";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set in .env");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    const { rows } = await client.query("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.name));

    if (cmd === "status") {
      files.forEach((f) => console.log(applied.has(f) ? "applied " : "pending ", f));
      return;
    }

    if (cmd === "seed") {
      console.log("Seeding moved to seed.js. Run: npm run seed");
      return;
    }

    const pending = files.filter((f) => !applied.has(f));
    if (!pending.length) return console.log("Nothing to migrate. Database is up to date.");

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(DIR, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log("Applied:", file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed and was rolled back: ${err.message}`);
      }
    }
    console.log("Done.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});