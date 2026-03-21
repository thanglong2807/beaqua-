require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const tables = ['danh_mucs', 'san_phams', 'files', 'up_files'];

  for (const table of tables) {
    const exists = await client.query('select to_regclass($1) as reg', [table]);
    const reg = exists.rows[0].reg;
    console.log(`\n=== ${table}: ${reg || 'NOT_FOUND'} ===`);
    if (!reg) continue;

    const columns = await client.query(
      `select column_name, data_type, is_nullable, column_default
       from information_schema.columns
       where table_name = $1
       order by ordinal_position`,
      [table]
    );

    for (const column of columns.rows) {
      console.log(column);
    }

    const count = await client.query(`select count(*)::int as c from ${table}`);
    console.log(`count=${count.rows[0].c}`);
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
