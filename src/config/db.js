const { Pool } = require('pg');
const path = require('path');

// বর্তমান ডিরেক্টরি থেকে এক ধাপ পেছনে গিয়ে .env ফাইলটি খুঁজবে
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: String(process.env.DB_PASSWORD), 
  port: process.env.DB_PORT,
});

pool.on('connect', () => {
  console.log('✅ PostgreSQL কানেক্ট হয়েছে!');
});

module.exports = pool;