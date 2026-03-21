require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const queries = [
    ['danh_mucs', 'select count(*)::int as c from danh_mucs'],
    ['san_phams', 'select count(*)::int as c from san_phams'],
    ['san_phams_danh_muc_lnk', 'select count(*)::int as c from san_phams_danh_muc_lnk'],
    [
      'files_related_mph products',
      "select count(*)::int as c from files_related_mph where related_type='api::san-pham.san-pham' and field='AnhDaiDien'",
    ],
    [
      'files_related_mph categories',
      "select count(*)::int as c from files_related_mph where related_type='api::danh-muc.danh-muc' and field='HinhAnh'",
    ],
  ];

  for (const [label, query] of queries) {
    const result = await client.query(query);
    console.log(`${label}: ${result.rows[0].c}`);
  }

  const sample = await client.query(
    `select dm.ten_danh_muc, count(sp.id)::int as product_count
     from danh_mucs dm
     left join san_phams_danh_muc_lnk l on l.danh_muc_id = dm.id
     left join san_phams sp on sp.id = l.san_pham_id
     group by dm.id, dm.ten_danh_muc
     order by dm.id`
  );

  console.log('\nProduct count by category:');
  console.table(sample.rows);

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
