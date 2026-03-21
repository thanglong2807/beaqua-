const qs = require('qs');

async function check() {
  const base = process.env.STRAPI_URL || 'http://localhost:1337';

  const categoryQuery = qs.stringify({
    filters: { id: { $eq: 1 } },
    populate: { HinhAnh: { populate: '*' } },
  }, { encodeValuesOnly: true });

  const productQuery = qs.stringify({
    pagination: { limit: 1 },
    populate: {
      AnhDaiDien: { populate: '*' },
      GalleryAnh: { populate: '*' },
    },
  }, { encodeValuesOnly: true });

  const categoryRes = await fetch(`${base}/api/danh-mucs?${categoryQuery}`);
  const categoryJson = await categoryRes.json();
  const productRes = await fetch(`${base}/api/san-phams?${productQuery}`);
  const productJson = await productRes.json();

  const category = categoryJson?.data?.[0] || null;
  const product = productJson?.data?.[0] || null;

  console.log('Category HinhAnh null?', category?.HinhAnh == null);
  console.log('Product AnhDaiDien null?', product?.AnhDaiDien == null);
  console.log('Product GalleryAnh count:', Array.isArray(product?.GalleryAnh) ? product.GalleryAnh.length : 0);
}

check().catch((e) => {
  console.error(e);
  process.exit(1);
});
