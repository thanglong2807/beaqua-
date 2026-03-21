const { createStrapi } = require('@strapi/strapi');
require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

async function main() {
  const pg = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await pg.connect();

  const dbCounts = await Promise.all([
    pg.query('select count(*)::int as c from danh_mucs'),
    pg.query('select count(*)::int as c from san_phams'),
    pg.query('select count(*)::int as c from bai_viets'),
  ]);

  console.log('SQL counts:', {
    danh_mucs: dbCounts[0].rows[0].c,
    san_phams: dbCounts[1].rows[0].c,
    bai_viets: dbCounts[2].rows[0].c,
  });

  const app = await createStrapi();
  await app.load();

  const categoryDocs = await app.documents('api::danh-muc.danh-muc').findMany({
    status: 'published',
    limit: 100,
  });

  const productDocs = await app.documents('api::san-pham.san-pham').findMany({
    status: 'published',
    limit: 200,
  });

  const postDocs = await app.documents('api::bai-viet.bai-viet').findMany({
    status: 'published',
    limit: 200,
  });

  console.log('Strapi documents counts:', {
    danh_mucs: categoryDocs.length,
    san_phams: productDocs.length,
    bai_viets: postDocs.length,
  });

  if (categoryDocs[0]) {
    console.log('Sample category document:', {
      id: categoryDocs[0].id,
      documentId: categoryDocs[0].documentId,
      TenDanhMuc: categoryDocs[0].TenDanhMuc,
      Slug: categoryDocs[0].Slug,
      locale: categoryDocs[0].locale,
      publishedAt: categoryDocs[0].publishedAt,
    });
  }

  await app.destroy();
  await pg.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
