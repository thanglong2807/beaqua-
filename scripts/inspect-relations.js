require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

async function logTable(client, tableName) {
  const columns = await client.query(
    `select column_name, data_type, is_nullable, column_default
     from information_schema.columns
     where table_name = $1
     order by ordinal_position`,
    [tableName]
  );
  console.log(`\n=== ${tableName} ===`);
  console.table(columns.rows);

  const count = await client.query(`select count(*)::int as c from ${tableName}`);
  console.log(`count=${count.rows[0].c}`);

  const sample = await client.query(`select * from ${tableName} limit 5`);
  console.log('sample:', sample.rows);
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  await logTable(client, 'san_phams_danh_muc_lnk');
  await logTable(client, 'files_related_mph');
  await logTable(client, 'files');

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
