require('dotenv').config({ path: '.env' });
const { Client } = require('pg');
const crypto = require('crypto');
const XLSX = require('xlsx');
const path = require('path');

function createDocumentId() {
  return crypto.randomBytes(12).toString('hex');
}

function normalizeSlug(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .slice(0, 200);
}

function textToBlocks(text) {
  if (!text) return [];
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => ({
      type: 'paragraph',
      children: [{ type: 'text', text: line }],
    }));
}

function readExcelData() {
  const excelPath = path.resolve(__dirname, '../../data.xlsx');
  const wb = XLSX.readFile(excelPath);
  const ws = wb.Sheets[wb.SheetNames[0]]; // Sheet "Sản phẩm"
  const rows = XLSX.utils.sheet_to_json(ws);
  return rows;
}

async function getExistingCounts(client) {
  const [categories, products] = await Promise.all([
    client.query('select count(*)::int as c from danh_mucs'),
    client.query('select count(*)::int as c from san_phams'),
  ]);
  return { categories: categories.rows[0].c, products: products.rows[0].c };
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
  const PRODUCT_DATA = readExcelData();
  console.log(`Đọc được ${PRODUCT_DATA.length} sản phẩm từ data.xlsx`);

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
      console.log('Xóa dữ liệu cũ...');
      await clearExistingData(client);
    }

    // Tạo map danh mục từ unique values trong Excel
    const categoryMap = new Map();
    PRODUCT_DATA.forEach(row => {
      const danhMuc = row['Danh mục'] || '';
      const catName = danhMuc.split('>').pop().trim();
      if (catName && !categoryMap.has(catName)) {
        categoryMap.set(catName, {
          name: catName,
          slug: normalizeSlug(catName),
        });
      }
    });

    const CATEGORY_SEEDS = Array.from(categoryMap.values());
    console.log(`Tạo ${CATEGORY_SEEDS.length} danh mục: ${CATEGORY_SEEDS.map(c => c.name).join(', ')}`);

    const now = new Date();
    const categoryIdMap = new Map(); // catName -> db id

    for (const category of CATEGORY_SEEDS) {
      const result = await client.query(
        `insert into danh_mucs (document_id, ten_danh_muc, slug, created_at, updated_at, published_at)
         values ($1, $2, $3, $4, $4, $4)
         returning id`,
        [createDocumentId(), category.name, category.slug, now]
      );
      categoryIdMap.set(category.name, result.rows[0].id);
    }

    console.log(`Tạo ${PRODUCT_DATA.length} sản phẩm...`);
    const slugCount = new Map();

    for (let i = 0; i < PRODUCT_DATA.length; i++) {
      const row = PRODUCT_DATA[i];
      const productName = row['Tên sản phẩm'] || `Sản phẩm ${i + 1}`;
      const moTa = row['Mô tả'] || '';
      const danhMuc = row['Danh mục'] || '';
      const catName = danhMuc.split('>').pop().trim();
      const categoryId = categoryIdMap.get(catName);

      // Tạo slug duy nhất
      let baseSlug = normalizeSlug(productName);
      if (!baseSlug) baseSlug = `san-pham-${i + 1}`;
      const count = slugCount.get(baseSlug) || 0;
      const slug = count === 0 ? baseSlug : `${baseSlug}-${count}`;
      slugCount.set(baseSlug, count + 1);

      // Mô tả ngắn: lấy 200 ký tự đầu của mô tả
      const moTaNgan = moTa ? moTa.slice(0, 200).trim() : null;

      // Blocks content từ toàn bộ mô tả
      const blocks = textToBlocks(moTa);

      const result = await client.query(
        `insert into san_phams (
           document_id, ten_san_pham, slug, mo_ta_ngan, thong_tin_chi_tiet,
           created_at, updated_at, published_at
         ) values ($1, $2, $3, $4, $5, $6, $6, $6)
         returning id`,
        [
          createDocumentId(),
          productName,
          slug,
          moTaNgan,
          JSON.stringify(blocks),
          now,
        ]
      );

      const productId = result.rows[0].id;

      // Liên kết danh mục
      if (categoryId) {
        await client.query(
          `insert into san_phams_danh_muc_lnk (san_pham_id, danh_muc_id) values ($1, $2)`,
          [productId, categoryId]
        );
      }

      if ((i + 1) % 50 === 0) {
        console.log(`  ...đã thêm ${i + 1}/${PRODUCT_DATA.length} sản phẩm`);
      }
    }

    await client.query('commit');
    console.log(`\nHoàn thành! Đã thêm ${CATEGORY_SEEDS.length} danh mục và ${PRODUCT_DATA.length} sản phẩm.`);
  } catch (error) {
    await client.query('rollback');
    console.error('Lỗi:', error.message);
    throw error;
  } finally {
    client.end();
  }
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
