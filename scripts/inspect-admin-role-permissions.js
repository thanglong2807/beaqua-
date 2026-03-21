require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const cols = await client.query(
    `select column_name, data_type
     from information_schema.columns
     where table_name='admin_permissions'
     order by ordinal_position`
  );

  console.log('admin_permissions columns:');
  console.table(cols.rows);

  const roleRows = await client.query(`
    select r.id, r.name, r.code
    from admin_roles r
    order by r.id
  `);
  console.log('roles:');
  console.table(roleRows.rows);

  const userRole = await client.query(`
    select u.email, r.id as role_id, r.name, r.code
    from admin_users u
    join admin_users_roles_lnk l on l.user_id = u.id
    join admin_roles r on r.id = l.role_id
    order by u.id
  `);
  console.log('user role mapping:');
  console.table(userRole.rows);

  const perms = await client.query(`
    select p.*
    from admin_permissions p
    join admin_permissions_role_lnk prl on prl.permission_id = p.id
    where prl.role_id = 1
      and p.action like 'plugin::content-manager.explorer.%'
    order by p.subject, p.action
  `);

  console.log(`role 1 content-manager perms count: ${perms.rowCount}`);
  console.dir(perms.rows, { depth: null });

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
