require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const tables = await client.query(
    `select table_name
     from information_schema.tables
     where table_schema='public' and (table_name like 'up_%' or table_name like '%permission%')
     order by table_name`
  );

  console.log('permission-related tables:', tables.rows.map((row) => row.table_name));

  const roleCols = await client.query(
    `select column_name from information_schema.columns where table_name='up_roles' order by ordinal_position`
  );
  const permCols = await client.query(
    `select column_name from information_schema.columns where table_name='up_permissions' order by ordinal_position`
  );
  const permRoleLnkCols = await client.query(
    `select column_name from information_schema.columns where table_name='up_permissions_role_lnk' order by ordinal_position`
  );

  console.log('up_roles columns:', roleCols.rows.map((row) => row.column_name));
  console.log('up_permissions columns:', permCols.rows.map((row) => row.column_name));
  console.log('up_permissions_role_lnk columns:', permRoleLnkCols.rows.map((row) => row.column_name));

  const roles = await client.query('select * from up_roles order by id');
  console.log('roles:', roles.rows);

  const perms = await client.query(
     `select p.id, p.action, lnk.role_id
      from up_permissions p
      left join up_permissions_role_lnk lnk on lnk.permission_id = p.id
      where p.action like 'api::danh-muc.%' or p.action like 'api::san-pham.%'
      order by lnk.role_id, p.action`
  );

  console.log('category/product permissions:', perms.rows);

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
