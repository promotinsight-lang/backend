const pool = require("../config/db");

const ensureSchema = async () => {
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS user_rank VARCHAR(100) DEFAULT 'New User'
  `);
};

module.exports = ensureSchema;
