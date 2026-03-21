require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const expected = [
    { table: 'danh_mucs', relatedType: 'api::danh-muc.danh-muc', field: 'HinhAnh' },
    { table: 'san_phams', relatedType: 'api::san-pham.san-pham', field: 'AnhDaiDien' },
    { table: 'san_phams', relatedType: 'api::san-pham.san-pham', field: 'GalleryAnh' },
    { table: 'bai_viets', relatedType: 'api::bai-viet.bai-viet', field: 'HinhDaiDien' },
  ];

  const aggregate = await client.query(
    `select related_type, field, count(*)::int as total
     from files_related_mph
     group by related_type, field
     order by related_type, field`
  );

  console.log('\n=== Current media relation aggregate ===');
  console.table(aggregate.rows);

  console.log('\n=== Coverage by expected image field ===');
  for (const item of expected) {
    const totalItemsRes = await client.query(`select count(*)::int as total from ${item.table}`);
    const linkedItemsRes = await client.query(
      `select count(distinct related_id)::int as linked
       from files_related_mph
       where related_type = $1 and field = $2`,
      [item.relatedType, item.field]
    );

    const total = totalItemsRes.rows[0].total;
    const linked = linkedItemsRes.rows[0].linked;
    const missing = total - linked;

    console.log(
      `${item.relatedType}.${item.field}: total=${total}, linked=${linked}, missing=${missing}`
    );
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
