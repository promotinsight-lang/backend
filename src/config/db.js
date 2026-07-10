const { Pool } = require('pg');
const path = require('path');

// বর্তমান ডিরেক্টরি থেকে এক ধাপ পেছনে গিয়ে .env ফাইলটি খুঁজবে
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const legacyDatabaseConfig = {
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
};
const hasLegacyDatabaseConfig = Object.values(legacyDatabaseConfig).every(Boolean);

const pool = new Pool(databaseUrl ? { connectionString: databaseUrl } : legacyDatabaseConfig);

const assertDatabaseConfiguration = () => {
  if (databaseUrl || hasLegacyDatabaseConfig) return;
  throw new Error('DATABASE_URL, or all of DB_USER, DB_HOST, DB_NAME, DB_PASSWORD, and DB_PORT, is required.');
};

pool.on('connect', () => {
  console.log('✅ PostgreSQL কানেক্ট হয়েছে!');
});

module.exports = pool;
module.exports.assertDatabaseConfiguration = assertDatabaseConfiguration;
