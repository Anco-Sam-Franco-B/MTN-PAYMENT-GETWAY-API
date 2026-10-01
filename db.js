const { Pool } = require("pg");
 
// Neon connection string already includes ?sslmode=require
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});
module.exports = db;