require('dotenv').config({ path: '.env' });
const { Client } = require('pg');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.resolve(__dirname, '../public/uploads');

const CATEGORY_NAMES = [
  'Phụ kiện cho thú cưng',
  'Thức ăn cho thú cưng',
  'Chăm sóc sức khỏe',
  'Vệ sinh cho thú cưng',
  'Ngoài trời & Sân vườn',
  'Dụng cụ điện và thiết bị lớn',
];

const TOTAL_PRODUCT_IMAGES = 30;

function createDocumentId() {
  return crypto.randomBytes(12).toString('hex');
}

function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    const doGet = (reqUrl, redirectCount = 0) => {
      if (redirectCount > 5) return reject(new Error('Too many redirects'));
      const proto = reqUrl.startsWith('https') ? https : http;
      const file = fs.createWriteStream(destPath);
      proto.get(reqUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
          file.close();
          fs.existsSync(destPath) && fs.unlinkSync(destPath);
          return doGet(res.headers.location, redirectCount + 1);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.existsSync(destPath) && fs.unlinkSync(destPath);
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', (err) => {
        file.close();
        fs.existsSync(destPath) && fs.unlinkSync(destPath);
        reject(err);
      });
    };
    doGet(url);
  });
}

function getFileSize(filePath) {
  try { return Math.round(fs.statSync(filePath).size / 1024 * 100) / 100; } catch { return 0; }
}

// ---- STEP 1: Download all images ----
async function downloadAllImages() {
  const manifest = [];

  console.log('=== BƯỚC 1: Tải ảnh danh mục (6 ảnh) ===');
  for (let i = 0; i < CATEGORY_NAMES.length; i++) {
    const hash = `cat_${i + 1}_${crypto.randomBytes(4).toString('hex')}`;
    const localPath = path.join(UPLOADS_DIR, `${hash}.jpg`);
    const url = `https://picsum.photos/seed/${i + 10}/800/600`;
    process.stdout.write(`  [${i+1}/6] ${CATEGORY_NAMES[i]}... `);
    try {
      await downloadImage(url, localPath);
      manifest.push({ type: 'category', index: i, catName: CATEGORY_NAMES[i], hash, localPath });
      console.log('OK');
    } catch (e) {
      console.log(`LỖI: ${e.message}`);
    }
  }

  console.log(`\n=== BƯỚC 1b: Tải ảnh sản phẩm (${TOTAL_PRODUCT_IMAGES} ảnh) ===`);
  for (let i = 0; i < TOTAL_PRODUCT_IMAGES; i++) {
    const hash = `prod_${i + 1}_${crypto.randomBytes(4).toString('hex')}`;
    const localPath = path.join(UPLOADS_DIR, `${hash}.jpg`);
    const url = `https://picsum.photos/seed/${i + 50}/800/600`;
    process.stdout.write(`  [${i+1}/${TOTAL_PRODUCT_IMAGES}]... `);
    try {
      await downloadImage(url, localPath);
      manifest.push({ type: 'product', index: i, hash, localPath });
      console.log('OK');
    } catch (e) {
      console.log(`LỖI: ${e.message}`);
    }
  }

  return manifest;
}

// ---- STEP 2: Insert into DB ----
async function updateDatabase(manifest) {
  console.log('\n=== BƯỚC 2: Cập nhật database ===');
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const now = new Date();

  try {
    await client.query('begin');

    // Insert file records
    const catFileMap = new Map(); // catName -> fileId
    const prodFileIds = [];

    for (const item of manifest) {
      const name = item.type === 'category'
        ? `category-${item.index + 1}.jpg`
        : `product-${item.index + 1}.jpg`;

      const result = await client.query(
        `insert into files (document_id, name, hash, ext, mime, size, url, provider, folder_path, created_at, updated_at, published_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$10) returning id`,
        [createDocumentId(), name, item.hash, '.jpg', 'image/jpeg',
         getFileSize(item.localPath), `/uploads/${item.hash}.jpg`, 'local', '/', now]
      );
      const fileId = result.rows[0].id;

      if (item.type === 'category') catFileMap.set(item.catName, fileId);
      else prodFileIds.push(fileId);
    }

    console.log(`  Đã insert ${manifest.length} file records`);

    // Gán ảnh cho danh mục
    await client.query(`delete from files_related_mph where related_type = 'api::danh-muc.danh-muc'`);
    const categories = await client.query('select id, ten_danh_muc from danh_mucs order by id');
    for (const cat of categories.rows) {
      const fileId = catFileMap.get(cat.ten_danh_muc) ?? [...catFileMap.values()][0];
      if (!fileId) continue;
      await client.query(
        `insert into files_related_mph (file_id, related_id, related_type, field, "order") values ($1,$2,$3,$4,$5)`,
        [fileId, cat.id, 'api::danh-muc.danh-muc', 'HinhAnh', 0]
      );
      console.log(`  ✓ Danh mục: ${cat.ten_danh_muc}`);
    }

    // Gán ảnh cho sản phẩm
    await client.query(`delete from files_related_mph where related_type = 'api::san-pham.san-pham'`);
    const products = await client.query('select id from san_phams order by id');
    for (let i = 0; i < products.rows.length; i++) {
      const fileId = prodFileIds[i % prodFileIds.length];
      await client.query(
        `insert into files_related_mph (file_id, related_id, related_type, field, "order") values ($1,$2,$3,$4,$5)`,
        [fileId, products.rows[i].id, 'api::san-pham.san-pham', 'AnhDaiDien', 0]
      );
      if ((i + 1) % 50 === 0) console.log(`  ...${i+1}/${products.rows.length} sản phẩm`);
    }

    await client.query('commit');
    console.log(`\n✓ Hoàn thành! ${categories.rows.length} danh mục + ${products.rows.length} sản phẩm đã có ảnh.`);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.end();
  }
}

async function main() {
  const manifest = await downloadAllImages();
  if (manifest.length === 0) throw new Error('Không tải được ảnh nào');
  await updateDatabase(manifest);
}

main().catch(err => { console.error('LỖI:', err.message); process.exit(1); });
