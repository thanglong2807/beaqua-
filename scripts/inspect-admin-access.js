require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const [users, roles, roleLinks, rolePerms, cmPerms] = await Promise.all([
    client.query('select id, email, firstname, lastname, is_active, blocked from admin_users order by id'),
    client.query('select id, name, code, description from admin_roles order by id'),
    client.query('select * from admin_users_roles_lnk order by user_id, role_id'),
    client.query('select * from admin_permissions_role_lnk order by role_id, permission_id limit 5000'),
    client.query("select id, action, subject from admin_permissions where action like 'plugin::content-manager.%' order by id"),
  ]);

  console.log('admin_users:', users.rows);
  console.log('admin_roles:', roles.rows);
  console.log('admin_users_roles_lnk:', roleLinks.rows);
  console.log('admin_permissions count:', rolePerms.rowCount);
  console.log('content-manager permissions sample:', cmPerms.rows.slice(0, 30));

  const userRolePerms = await client.query(`
    select u.email, r.name as role_name, p.action, p.subject
    from admin_users u
    left join admin_users_roles_lnk url on url.user_id = u.id
    left join admin_roles r on r.id = url.role_id
    left join admin_permissions_role_lnk prl on prl.role_id = r.id
    left join admin_permissions p on p.id = prl.permission_id
    where p.action like 'plugin::content-manager.%'
    order by u.email, r.name, p.action
  `);

  console.log('user content-manager perms:', userRolePerms.rows);

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
