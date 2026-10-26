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

## 7) Rasmlarni optimallashtirish (3 o'lcham)

Savol rasmlari R2 da `images/<nom>.<ext>` ko'rinishida turadi. Har biri uchun 3 ta webp variant
saqlanadi: `images/s/<nom>.webp` (480 px), `images/m/…` (800 px), `images/l/…` (1280 px).
Frontend (`ResponsiveImage`, `srcset`) ekran o'lchamiga mosini o'zi tanlaydi; variant bo'lmasa
asl rasmga qaytadi, shuning uchun bazadagi URL'larni o'zgartirish shart emas.

- **Yangi rasmlar** admin paneldan yuklanganda avtomatik siqiladi (asl nusxa webp, ≤1600 px) va 3 ta
  variant yaratiladi; rasm almashtirilsa/o'chirilsa variantlari ham o'chadi.
- **Mavjud rasmlar** uchun bir martalik skript (serverda, `.env` da R2 kalitlari bo'lishi kerak):

```bash
./scripts/optimize-images.sh                 # DRY-RUN: nima qilinishini ko'rsatadi
./scripts/optimize-images.sh --apply --limit=20   # avval 20 tasida sinab ko'ring
./scripts/optimize-images.sh --apply         # hammasini bajarish (qayta ishga tushirish xavfsiz)
./scripts/optimize-images.sh --apply --fix-cache-headers   # asl fayllarga ham uzoq kesh sarlavhasi
```

Asl rasmlar o'chirilmaydi. R2 ni o'z domeniga (masalan `cdn.topshirdi.uz`) ulasangiz,
`NEXT_PUBLIC_IMAGE_HOSTS=cdn.topshirdi.uz` ni build argumenti sifatida bering.
