require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const result = await client.query(`
    select
      r.id as role_id,
      r.name,
      p.id as perm_id,
      p.action,
      p.subject,
      p.conditions,
      p.action_parameters,
      p.properties
    from admin_roles r
    join admin_permissions_role_lnk l on l.role_id = r.id
    join admin_permissions p on p.id = l.permission_id
    where r.id = 1
      and p.action = 'plugin::content-manager.explorer.read'
      and p.subject in (
        'api::danh-muc.danh-muc',
        'api::san-pham.san-pham',
        'api::bai-viet.bai-viet'
      )
    order by p.subject, p.id
  `);

  console.dir(result.rows, { depth: null });

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
