"""
Xóa file records cũ (local uploads), thay bằng link Shopee CDN trực tiếp.
"""
import os, re, uuid, hashlib, unicodedata, json
import pandas as pd
import psycopg2
from urllib.parse import urlparse


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
            os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def get_db_connection():
    load_env()
    url = os.getenv('DATABASE_URL')
    parsed = urlparse(url)
    return psycopg2.connect(
        dbname=parsed.path.lstrip('/'),
        user=parsed.username,
        password=parsed.password,
        host=parsed.hostname,
        port=parsed.port or 5432,
        sslmode='require',
    )


def main():
    xls = pd.ExcelFile('data.xlsx')
    df = pd.read_excel(xls, 'Sản phẩm')

    conn = get_db_connection()
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            # Lấy map slug -> product_id
            cur.execute("SELECT id, slug FROM san_phams")
            slug_to_id = {row[1]: row[0] for row in cur.fetchall()}

            # Xóa toàn bộ file records và links cũ của san_phams
            cur.execute(
                "DELETE FROM files_related_mph WHERE related_type = 'api::san-pham.san-pham' AND field IN ('AnhDaiDien','GalleryAnh')"
            )
            print(f"Deleted old links: {cur.rowcount}")

            cur.execute("DELETE FROM files WHERE provider = 'local'")
            print(f"Deleted old local file records: {cur.rowcount}")

            total_inserted = 0
            total_linked = 0
            no_product = 0

            for idx, row in df.iterrows():
                name = str(row.get('Tên sản phẩm', '')).strip()
                if not name:
                    continue

                slug = slugify(name) or f'product-{idx+1}'
                product_id = slug_to_id.get(slug)
                if not product_id:
                    for s, pid in slug_to_id.items():
                        if s.startswith(slug[:30]):
                            product_id = pid
                            break
                if not product_id:
                    no_product += 1
                    continue

                links_raw = str(row.get('Link ảnh', '')).strip()
                if not links_raw or links_raw == 'nan':
                    continue

                urls = [u.strip() for u in links_raw.splitlines() if u.strip()]

                for img_idx, img_url in enumerate(urls):
                    h = hashlib.md5(img_url.encode()).hexdigest()[:16]

                    # Kiểm tra đã có trong files chưa
                    cur.execute("SELECT id FROM files WHERE hash = %s", (h,))
                    existing = cur.fetchone()
                    if existing:
                        file_id = existing[0]
                    else:
                        doc_id = uuid.uuid4().hex
                        filename = h + '.jpg'
                        cur.execute(
                            """
                            INSERT INTO files
                              (document_id, name, hash, ext, mime, size, url,
                               width, height, provider, folder_path, formats,
                               created_at, updated_at, published_at)
                            VALUES
                              (%s, %s, %s, '.jpg', 'image/jpeg', 0, %s,
                               800, 800, 'external', '/', '{}',
                               NOW(), NOW(), NOW())
                            RETURNING id
                            """,
                            (doc_id, filename, h, img_url),
                        )
                        file_id = cur.fetchone()[0]
                        total_inserted += 1

                    # Link AnhDaiDien (ảnh đầu tiên) + GalleryAnh (tất cả)
                    if img_idx == 0:
                        cur.execute(
                            """INSERT INTO files_related_mph (file_id, related_id, related_type, field, "order")
                               VALUES (%s,%s,'api::san-pham.san-pham','AnhDaiDien',0)
                               ON CONFLICT DO NOTHING""",
                            (file_id, product_id),
                        )
                    cur.execute(
                        """INSERT INTO files_related_mph (file_id, related_id, related_type, field, "order")
                           VALUES (%s,%s,'api::san-pham.san-pham','GalleryAnh',%s)
                           ON CONFLICT DO NOTHING""",
                        (file_id, product_id, img_idx),
                    )
                    total_linked += 1

                if (idx + 1) % 50 == 0:
                    conn.commit()
                    print(f"  Committed at product {idx+1}...")

            conn.commit()
            print(f"\nDone!")
            print(f"  File records inserted: {total_inserted}")
            print(f"  Links created:         {total_linked}")
            print(f"  Products not found:    {no_product}")

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    main()
