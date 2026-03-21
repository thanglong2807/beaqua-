require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

async function getCounts(client) {
  const result = await client.query(`
    select 'danh_mucs' as table_name, count(*)::int as total from danh_mucs
    union all
    select 'san_phams', count(*)::int from san_phams
    union all
    select 'bai_viets', count(*)::int from bai_viets
    union all
    select 'files', count(*)::int from files
    union all
    select 'files_related_mph', count(*)::int from files_related_mph
    union all
    select 'san_phams_danh_muc_lnk', count(*)::int from san_phams_danh_muc_lnk
    union all
    select 'files_folder_lnk', count(*)::int from files_folder_lnk
  `);

  return result.rows;
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const before = await getCounts(client);
    console.log('=== BEFORE PURGE ===');
    console.table(before);

    await client.query('begin');

    await client.query('delete from files_related_mph');
    await client.query('delete from san_phams_danh_muc_lnk');
    await client.query('delete from bai_viets');
    await client.query('delete from san_phams');
    await client.query('delete from danh_mucs');
    await client.query('delete from files_folder_lnk');
    await client.query('delete from files');

    await client.query(`
      select setval(pg_get_serial_sequence('danh_mucs', 'id'), 1, false),
             setval(pg_get_serial_sequence('san_phams', 'id'), 1, false),
             setval(pg_get_serial_sequence('bai_viets', 'id'), 1, false),
             setval(pg_get_serial_sequence('files', 'id'), 1, false),
             setval(pg_get_serial_sequence('files_related_mph', 'id'), 1, false),
             setval(pg_get_serial_sequence('san_phams_danh_muc_lnk', 'id'), 1, false),
             setval(pg_get_serial_sequence('files_folder_lnk', 'id'), 1, false)
    `);

    await client.query('commit');

    const after = await getCounts(client);
    console.log('=== AFTER PURGE ===');
    console.table(after);

    console.log('Đã xóa sạch dữ liệu nội dung và media trong DB.');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
