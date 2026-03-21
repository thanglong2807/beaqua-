require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const tables = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema='public'
      and (
        table_name like '%document%'
        or table_name like '%workflow%'
        or table_name like '%stage%'
        or table_name like 'strapi_%'
      )
    order by table_name
  `);

  for (const row of tables.rows) {
    const tableName = row.table_name;
    const count = await client.query(`select count(*)::int as c from ${tableName}`);
    console.log(`${tableName}: ${count.rows[0].c}`);
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
