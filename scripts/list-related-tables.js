require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const result = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema='public'
      and (
        table_name like '%san_pham%'
        or table_name like '%danh_muc%'
        or table_name like '%bai_viet%'
        or table_name like '%file%'
      )
    order by table_name
  `);

  for (const row of result.rows) {
    console.log(row.table_name);
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
