"""
Download product images from Excel, save to public/uploads/,
insert into files table, and link to san_phams via files_related_mph.
"""
import os
import re
import uuid
import json
import hashlib
import unicodedata
import mimetypes
import time
import requests
import pandas as pd
import psycopg2
from urllib.parse import urlparse
from pathlib import Path
from PIL import Image as PILImage
import io

UPLOADS_DIR = Path(__file__).parent / 'public' / 'uploads'
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://shopee.vn/',
}


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


def make_hash(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()[:16]


def download_image(url: str, dest_path: Path, retries: int = 3) -> bool:
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=20, stream=True)
            if resp.status_code == 200:
                dest_path.write_bytes(resp.content)
                return True
            print(f'  HTTP {resp.status_code} for {url}')
        except Exception as e:
            print(f'  Attempt {attempt+1} failed: {e}')
            time.sleep(1)
    return False


def get_image_info(path: Path):
    try:
        with PILImage.open(path) as img:
            width, height = img.size
            fmt = img.format or 'JPEG'
            mime = f'image/{fmt.lower()}'
            return width, height, mime
    except Exception:
        return None, None, 'image/jpeg'


def insert_file(cur, name: str, hash_val: str, ext: str, mime: str,
                size_kb: float, url: str, width, height) -> int:
    doc_id = uuid.uuid4().hex
    cur.execute(
        """
        INSERT INTO files
          (document_id, name, hash, ext, mime, size, url, width, height,
           provider, folder_path, formats, created_at, updated_at, published_at)
        VALUES
          (%s, %s, %s, %s, %s, %s, %s, %s, %s,
           'local', '/', '{}', NOW(), NOW(), NOW())
        RETURNING id
        """,
        (doc_id, name, hash_val, ext, mime, size_kb, url, width, height),
    )
    return cur.fetchone()[0]


def link_file(cur, file_id: int, product_id: int, field: str, order: int):
    cur.execute(
        """
        INSERT INTO files_related_mph (file_id, related_id, related_type, field, "order")
        VALUES (%s, %s, 'api::san-pham.san-pham', %s, %s)
        ON CONFLICT DO NOTHING
        """,
        (file_id, product_id, field, order),
    )


def main():
    xls = pd.ExcelFile('data.xlsx')
    df = pd.read_excel(xls, 'Sản phẩm')

    conn = get_db_connection()
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            # Get product id map by slug
            cur.execute("SELECT id, slug FROM san_phams")
            slug_to_id = {row[1]: row[0] for row in cur.fetchall()}

            # Clear existing file links for san_phams
            cur.execute(
                "DELETE FROM files_related_mph WHERE related_type = 'api::san-pham.san-pham' AND field IN ('AnhDaiDien','GalleryAnh')"
            )
            print("Cleared old image links.")

            total_downloaded = 0
            total_failed = 0

            for idx, row in df.iterrows():
                name = str(row.get('Tên sản phẩm', '')).strip()
                if not name:
                    continue

                slug = slugify(name) or f'product-{idx+1}'
                product_id = slug_to_id.get(slug)
                if not product_id:
                    # try partial match
                    for s, pid in slug_to_id.items():
                        if s.startswith(slug[:30]):
                            product_id = pid
                            break
                if not product_id:
                    print(f'[{idx}] Product not found in DB: {name[:60]}')
                    continue

                links_raw = str(row.get('Link ảnh', '')).strip()
                if not links_raw or links_raw == 'nan':
                    continue

                urls = [u.strip() for u in links_raw.splitlines() if u.strip()]
                print(f'[{idx+1}/270] {name[:50]} - {len(urls)} anh')

                for img_idx, img_url in enumerate(urls):
                    h = make_hash(img_url)
                    ext = '.jpg'
                    filename = f'{h}{ext}'
                    dest = UPLOADS_DIR / filename
                    web_url = f'/uploads/{filename}'

                    # Check if already in DB by url
                    cur.execute("SELECT id FROM files WHERE url = %s", (web_url,))
                    existing = cur.fetchone()
                    if existing:
                        file_id = existing[0]
                    else:
                        if not dest.exists():
                            ok = download_image(img_url, dest)
                            if not ok:
                                total_failed += 1
                                continue
                        size_kb = round(dest.stat().st_size / 1024, 2)
                        width, height, mime = get_image_info(dest)
                        file_id = insert_file(
                            cur,
                            name=filename,
                            hash_val=h,
                            ext=ext,
                            mime=mime,
                            size_kb=size_kb,
                            url=web_url,
                            width=width,
                            height=height,
                        )
                        total_downloaded += 1

                    # Link: first image = AnhDaiDien, all = GalleryAnh
                    if img_idx == 0:
                        link_file(cur, file_id, product_id, 'AnhDaiDien', 0)
                    link_file(cur, file_id, product_id, 'GalleryAnh', img_idx)

                # Commit every 10 products
                if (idx + 1) % 10 == 0:
                    conn.commit()
                    print(f'  Committed at product {idx+1}')

            conn.commit()
            print(f'\nDone! Downloaded: {total_downloaded}, Failed: {total_failed}', flush=True)

    except Exception as e:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    main()
