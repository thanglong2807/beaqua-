require('dotenv').config({ path: '.env' });
const { Client } = require('pg');
const crypto = require('crypto');
const PRODUCT_DATA = require('./data');

function createDocumentId() {
  return crypto.randomBytes(12).toString('hex');
}

function createBlocksContent(productName) {
  return [
    {
      type: 'paragraph',
      children: [
        {
          type: 'text',
          text: `${productName} là sản phẩm chất lượng cao, phù hợp cho người mới lẫn người chơi lâu năm.`,
        },
      ],
    },
    {
      type: 'paragraph',
      children: [
        {
          type: 'text',
          text: 'Sản phẩm khỏe mạnh, dễ thích nghi và đã được kiểm tra chất lượng trước khi giao.',
        },
      ],
    },
  ];
}

function formatVnd(value) {
  return `${value.toLocaleString('vi-VN')}đ`;
}

function normalizeSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

async function getExistingCounts(client) {
  const [categories, products] = await Promise.all([
    client.query('select count(*)::int as c from danh_mucs'),
    client.query('select count(*)::int as c from san_phams'),
  ]);

  return {
    categories: categories.rows[0].c,
    products: products.rows[0].c,
  };
}

async function clearExistingData(client) {
  await client.query('delete from files_related_mph where related_type in ($1, $2)', [
    'api::san-pham.san-pham',
    'api::danh-muc.danh-muc',
  ]);
  await client.query('delete from san_phams_danh_muc_lnk');
  await client.query('delete from san_phams');
  await client.query('delete from danh_mucs');
}

async function seed() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const shouldClear = process.argv.includes('--clear');

  await client.connect();

  try {
    await client.query('begin');

    const existing = await getExistingCounts(client);
    if ((existing.categories > 0 || existing.products > 0) && !shouldClear) {
      throw new Error(
        `Phát hiện dữ liệu hiện có (danh_mucs=${existing.categories}, san_phams=${existing.products}). Chạy lại với --clear để xóa và seed mới.`
      );
    }

    if (shouldClear) {
      await clearExistingData(client);
    }

    // Tạo categories từ unique danh mục
    const categoryMap = new Map();
    PRODUCT_DATA.forEach(product => {
      if (!categoryMap.has(product['Danh mục'])) {
        categoryMap.set(product['Danh mục'], {
          name: product['Danh mục'].split(' > ').pop(),
          slug: normalizeSlug(product['Danh mục'].split(' > ').pop()),
        });
      }
    });

    const CATEGORY_SEEDS = Array.from(categoryMap.values());

    const fileResult = await client.query('select id from files order by id asc');
    const fileIds = fileResult.rows.map((row) => row.id);

    const createdCategoryIds = [];
    const categoryIdMap = new Map();
    const now = new Date();

    for (let i = 0; i < CATEGORY_SEEDS.length; i += 1) {
      const category = CATEGORY_SEEDS[i];

      const categoryInsert = await client.query(
        `insert into danh_mucs (document_id, ten_danh_muc, slug, created_at, updated_at, published_at)
         values ($1, $2, $3, $4, $4, $4)
         returning id`,
        [createDocumentId(), category.name, category.slug, now]
      );

      const categoryId = categoryInsert.rows[0].id;
      createdCategoryIds.push(categoryId);
      categoryIdMap.set(category.name, categoryId);

      if (fileIds.length > 0) {
        const categoryFileId = fileIds[i % fileIds.length];
        await client.query(
          `insert into files_related_mph (file_id, related_id, related_type, field, "order")
           values ($1, $2, $3, $4, $5)`,
          [categoryFileId, categoryId, 'api::danh-muc.danh-muc', 'HinhAnh', 0]
        );
      }
    }

    // Tạo products từ PRODUCT_DATA
    for (let i = 0; i < PRODUCT_DATA.length; i += 1) {
      const productData = PRODUCT_DATA[i];
      const productName = productData['Tên sản phẩm'];
      const categoryName = productData['Danh mục'].split(' > ').pop();
      const categoryId = categoryIdMap.get(categoryName);
      const productSlug = normalizeSlug(productName);
      const price = Math.floor(Math.random() * 450000) + 50000; // Random price 50k to 500k

      const productInsert = await client.query(
        `insert into san_phams (
           document_id, ten_san_pham, slug, gia, thong_tin_chi_tiet, created_at, updated_at, published_at
         ) values ($1, $2, $3, $4, $5, $6, $6, $6)
         returning id`,
        [createDocumentId(), productName, productSlug, price, JSON.stringify(createBlocksContent(productName)), now]
      );

      const productId = productInsert.rows[0].id;

      // Link to category
      await client.query(
        `insert into san_phams_danh_muc_lnk (san_pham_id, danh_muc_id)
         values ($1, $2)`,
        [productId, categoryId]
      );

      if (fileIds.length > 0) {
        const productFileId = fileIds[i % fileIds.length];
        await client.query(
          `insert into files_related_mph (file_id, related_id, related_type, field, "order")
           values ($1, $2, $3, $4, $5)`,
          [productFileId, productId, 'api::san-pham.san-pham', 'HinhAnh', 0]
        );
      }
    }

    await client.query('commit');
    console.log('Seed completed successfully');
  } catch (error) {
    await client.query('rollback');
    console.error('Seed failed:', error);
    throw error;
  }

  client.end();
}

(async () => {
  await seed();
})().catch(console.error);
