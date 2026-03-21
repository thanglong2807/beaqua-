# Deploy Strapi Backend lên Railway

## 1) Tạo service mới
- Vào Railway → `New Project` → `Deploy from GitHub repo`.
- Chọn repo hiện tại.
- Ở service settings, đặt `Root Directory` là `backend`.
- Railway sẽ dùng `Dockerfile` + `railway.json` trong thư mục này.

## 2) Cấu hình Environment Variables
Thêm các biến sau trong Railway (`Variables`):

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `PORT` **KHÔNG tự set** (Railway tự inject cổng runtime)
- `DATABASE_CLIENT=postgres`
- `DATABASE_URL=<postgres-connection-string>`
- `DATABASE_SSL=true`
- `DATABASE_SSL_REJECT_UNAUTHORIZED=false`
- `APP_KEYS=<k1>,<k2>,<k3>,<k4>`
- `API_TOKEN_SALT=<random-string>`
- `ADMIN_JWT_SECRET=<random-string>`
- `TRANSFER_TOKEN_SALT=<random-string>`
- `ENCRYPTION_KEY=<random-string>`
- `JWT_SECRET=<random-string>`

## 3) Tạo secret ngẫu nhiên (khuyến nghị)
Có thể chạy local để tạo nhanh:

```bash
node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('base64'))"
```

## 4) Deploy
- Bấm `Deploy`.
- Sau khi build xong, mở URL service và truy cập `/admin`.

## 4.1) Nếu healthcheck fail ở `/admin`
- Xóa biến `PORT` nếu bạn đã set thủ công.
- Kiểm tra có đủ các secret bắt buộc: `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `ENCRYPTION_KEY`, `JWT_SECRET`.
- Kiểm tra `DATABASE_URL` đúng và DB cho phép kết nối từ Railway.
- Bật lại deploy (Redeploy).

## 5) Nếu gặp lỗi CORS/URL frontend
- Đảm bảo frontend dùng đúng URL backend production:
  - `NEXT_PUBLIC_STRAPI_API_URL=https://<your-railway-domain>`
