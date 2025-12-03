// scripts/db-debug.js
// Run: node scripts/db-debug.js
// This script uses the project's `db.js` MySQL connection to run diagnostic queries
const db = require('../db');

function runQuery(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params || [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

(async () => {
  try {
    console.log('\n1) Distinct raw category values (trimmed, length, hex)');
    const distinct = await runQuery("SELECT DISTINCT category, TRIM(category) AS trimmed, LENGTH(category) AS len, HEX(category) AS hex FROM products ORDER BY trimmed NULLS FIRST, category LIMIT 200");
    console.table(distinct);

    console.log('\n2) Rows likely to be Snacks by productName keywords');
    const snacksByName = await runQuery("SELECT id, productName, category FROM products WHERE LOWER(productName) LIKE '%chip%' OR LOWER(productName) LIKE '%cookie%' OR LOWER(productName) LIKE '%ruffle%' OR LOWER(productName) LIKE '%dorito%' OR LOWER(productName) LIKE '%lays%' LIMIT 200");
    console.table(snacksByName);

    console.log('\n3) Rows where category looks like Snack/Snacks');
    const snacksByCat = await runQuery("SELECT id, productName, category, LENGTH(category) AS len, HEX(category) AS hex FROM products WHERE LOWER(TRIM(category)) IN ('snack','snacks') LIMIT 200");
    console.table(snacksByCat);

    console.log('\nDone.');
    process.exit(0);
  } catch (err) {
    console.error('Error running diagnostics:', err && err.stack ? err.stack : err);
    process.exit(2);
  }
})();
