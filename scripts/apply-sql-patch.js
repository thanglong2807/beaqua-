require('dotenv').config({ path: '.env' });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const sqlRelativePath = process.argv[2];
  if (!sqlRelativePath) {
    throw new Error('Usage: node scripts/apply-sql-patch.js <relative-sql-file-path>');
  }

  const sqlPath = path.resolve(process.cwd(), sqlRelativePath);
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query(sql);
    console.log(`Applied SQL patch: ${sqlRelativePath}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
