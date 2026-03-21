import os, re, unicodedata, json
from urllib.parse import urlparse
import pandas as pd
import psycopg2


def slugify(value: str) -> str:
    value = str(value or '').strip().lower()
    value = unicodedata.normalize('NFKD', value)
    value = value.encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'[^a-z0-9]+', '-', value)
    return value.strip('-')


def load_env(env_path='.env'):
    if not os.path.exists(env_path):
        return
    with open(env_path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, val = line.split('=', 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            os.environ.setdefault(key, val)


def get_db_connection():
    load_env()
    url = os.getenv('DATABASE_URL')
    if not url:
        raise RuntimeError('DATABASE_URL is not set in environment or .env')
    parsed = urlparse(url)
    return psycopg2.connect(
        dbname=parsed.path.lstrip('/'),
        user=parsed.username,
        password=parsed.password,
        host=parsed.hostname,
        port=parsed.port or 5432,
        sslmode='require' if parsed.scheme.startswith('postgres') else None,
    )


def main():
    workbook = 'data.xlsx'
    if not os.path.exists(workbook):
        raise FileNotFoundError(workbook)

    xls = pd.ExcelFile(workbook)
    if 'Sản phẩm' not in xls.sheet_names or 'Danh mục' not in xls.sheet_names:
        raise RuntimeError('Workbook must contain "Sản phẩm" and "Danh mục" sheets')

    df_products = pd.read_excel(xls, 'Sản phẩm')
    df_categories = pd.read_excel(xls, 'Danh mục')

    cat_col = 'Tên danh mục'
    if cat_col not in df_categories.columns:
        raise RuntimeError(f'Category sheet missing column {cat_col}')

    categories = []
    for c in df_categories[cat_col].dropna().astype(str).unique():
        categories.append(c.strip())

    prod_cat_col = 'Danh mục'
    if prod_cat_col not in df_products.columns:
        raise RuntimeError(f'Product sheet missing column {prod_cat_col}')

    for c in df_products[prod_cat_col].dropna().astype(str).unique():
        if c.strip() and c.strip() not in categories:
            categories.append(c.strip())

    # De-duplicate and preserve order
    seen = set()
    categories = [c for c in categories if not (c in seen or seen.add(c))]

    print(f'Found {len(categories)} categories and {len(df_products)} products')

    conn = get_db_connection()
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            # Clean existing data
            cur.execute('DELETE FROM san_phams_danh_muc_lnk')
            cur.execute('DELETE FROM san_phams')
            cur.execute('DELETE FROM danh_mucs')

            # Reset sequences if exist
            for seq in ['danh_mucs_id_seq', 'san_phams_id_seq', 'san_phams_danh_muc_lnk_id_seq']:
                cur.execute("SELECT 1 FROM information_schema.sequences WHERE sequence_name = %s", (seq,))
                if cur.fetchone():
                    cur.execute(f"ALTER SEQUENCE {seq} RESTART WITH 1")

            # Insert categories
            cat_ids = {}
            slug_counts = {}
            for c in categories:
                slug = slugify(c)
                if not slug:
                    slug = 'category'
                slug_counts.setdefault(slug, 0)
                if slug_counts[slug] > 0:
                    slug = f"{slug}-{slug_counts[slug]}"
                slug_counts[slug] += 1

                cur.execute(
                    "INSERT INTO danh_mucs (ten_danh_muc, slug) VALUES (%s,%s) RETURNING id",
                    (c, slug),
                )
                cat_ids[c] = cur.fetchone()[0]

            # Products insert
            prod_insert = []
            for idx, row in df_products.iterrows():
                name = str(row.get('Tên sản phẩm', '')).strip()
                if not name:
                    continue
                category = str(row.get('Danh mục', '')).strip()
                if not category:
                    category = None
                cat_id = cat_ids.get(category)

                description = str(row.get('Mô tả', '')).strip()
                mo_ta_ngan = description[:1024]

                extra = {
                    'link_anh': str(row.get('Link ảnh', '')).strip(),
                    'da_ban': int(row.get('Đã bán', 0)) if pd.notna(row.get('Đã bán', None)) else None,
                    'ton_kho': int(row.get('Tồn kho', 0)) if pd.notna(row.get('Tồn kho', None)) else None,
                    'danh_gia': float(row.get('Đánh giá', 0)) if pd.notna(row.get('Đánh giá', None)) else None,
                    'link_san_pham': str(row.get('Link sản phẩm', '')).strip(),
                }
                product_json = {
                    'mo_ta': description,
                    'meta': {k: v for k, v in extra.items() if v not in (None, '')}
                }

                slug = slugify(name)
                if not slug:
                    slug = f"product-{idx+1}"

                gia = str(row.get('Giá', '')).strip()

                prod_insert.append((name, slug, mo_ta_ngan, product_json, gia, cat_id, idx))

            # Insert san_phams and link relations
            prod_id_map = {}
            for name, slug, mo_ta_ngan, thong_tin, gia, cat_id, order in prod_insert:
                cur.execute(
                    "INSERT INTO san_phams (ten_san_pham, slug, mo_ta_ngan, thong_tin_chi_tiet, gia, la_san_pham_noi_bat) VALUES (%s,%s,%s,%s,%s,false) RETURNING id",
                    (name, slug, mo_ta_ngan, json.dumps(thong_tin, ensure_ascii=False), gia),
                )
                prod_id = cur.fetchone()[0]
                if cat_id:
                    cur.execute(
                        "INSERT INTO san_phams_danh_muc_lnk (san_pham_id, danh_muc_id, san_pham_ord) VALUES (%s,%s,%s)",
                        (prod_id, cat_id, order + 1),
                    )

            conn.commit()
            print('Import completed: categories:', len(categories), 'products:', len(prod_insert))
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    import json
    main()
