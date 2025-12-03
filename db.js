const mysql = require('mysql2');

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Republic_C207',
    database: 'c372_supermarketdb'
  });

db.connect((err) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    return;
  }
  // debug-level: avoid noisy startup logs in normal runs
  console.debug('✅ MySQL Connected!');
});

module.exports = db;
