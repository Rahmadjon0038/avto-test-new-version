# Jo‘rabek Avto Test

Haydovchilik test platformasi: Next.js + PostgreSQL.

## 1) O‘rnatish

```bash
npm install
```

## 2) .env sozlash

`.env.example` ni nusxa oling:

```bash
cp .env.example .env
```

`.env` ichida quyidagilarni to‘ldiring:

- `BASE_URL` — public HTTPS URL (ngrok yoki hosting). Masalan: `https://topshirdi.uz`
- `CARD_NUMBER` — to‘lov uchun karta raqami (matn)
- `SESSION_SECRET` — random string (browser login session uchun)
- `DATABASE_URL` — local Postgres connection string, masalan: `postgresql:///avtotest`

## 3) Serverni ishga tushirish

```bash
npm run dev
```

Bu buyruq `frontend/` va `backend/` ni birga ishga tushiradi.

Server:
- Landing (sayt auth): `GET /`
- App: `GET /app`
- Web App: `GET /webapp`
- Health: `GET /health`

## 4) Ngrok bilan test qilish

1) Yangi terminal:
   ```bash
   ngrok http 3000
   ```
2) Ngrok bergan `https://...` URL ni `.env` dagi `BASE_URL` ga yozing.
3) Ilovani qayta ishga tushiring.

## 5) Development

Brauzerda test qilish uchun:

- `NODE_ENV=development` qilib ishga tushiring:
  ```bash
  npm run dev
  ```

## 6) Browser orqali login

Sayt bosh sahifasida ism + telefon orqali kirish (MVP) mavjud.
