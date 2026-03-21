require('dotenv').config({ path: '.env' });
const { Client } = require('pg');
const crypto = require('crypto');

function createDocumentId() {
  return crypto.randomBytes(12).toString('hex');
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query('begin');

    const publicRoleResult = await client.query(
      "select id from up_roles where type = 'public' limit 1"
    );

    if (publicRoleResult.rows.length === 0) {
      throw new Error('Không tìm thấy role Public trong up_roles');
    }

    const publicRoleId = publicRoleResult.rows[0].id;

    const actions = [
      'api::danh-muc.danh-muc.find',
      'api::danh-muc.danh-muc.findOne',
      'api::san-pham.san-pham.find',
      'api::san-pham.san-pham.findOne',
      'api::bai-viet.bai-viet.find',
      'api::bai-viet.bai-viet.findOne',
    ];

    const now = new Date();

    for (const action of actions) {
      const existing = await client.query(
        `select p.id
         from up_permissions p
         inner join up_permissions_role_lnk lnk on lnk.permission_id = p.id
         where p.action = $1 and lnk.role_id = $2
         limit 1`,
        [action, publicRoleId]
      );

      if (existing.rows.length > 0) {
        continue;
      }

      const permissionInsert = await client.query(
        `insert into up_permissions (document_id, action, created_at, updated_at, published_at)
         values ($1, $2, $3, $3, $3)
         returning id`,
        [createDocumentId(), action, now]
      );

      const permissionId = permissionInsert.rows[0].id;

      await client.query(
        `insert into up_permissions_role_lnk (permission_id, role_id, permission_ord)
         values ($1, $2, $3)`,
        [permissionId, publicRoleId, 0]
      );
    }

    await client.query('commit');
    console.log('Đã cấp quyền Public thành công cho danh mục/sản phẩm/bài viết.');
  } catch (error) {
    await client.query('rollback');
    console.error('Cấp quyền thất bại:', error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
