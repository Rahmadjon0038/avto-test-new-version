# Jo‘rabek Avto Test (MVP)

Telegram Web App ichida ishlaydigan haydovchilik test platformasi: Node.js + Express + SQLite3 + Telegraf.

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

- `BOT_TOKEN` — BotFather bergan token
- `ADMIN_TELEGRAM_ID` — admin telegram id (raqam)
- `BASE_URL` — public HTTPS URL (ngrok yoki hosting). Masalan: `https://xxxx.ngrok-free.app`
- `CARD_NUMBER` — to‘lov uchun karta raqami (matn)
- `SESSION_SECRET` — random string (browser login session uchun)

## 3) Serverni ishga tushirish

```bash
npm start
```

Server:
- Web App: `GET /webapp`
- Health: `GET /health`

## 4) Botni ishga tushirish

Albatta alohida terminalda:

```bash
npm run bot
```

Bot long-polling ishlaydi.

## 5) Ngrok bilan test qilish

1) Web serverni ishga tushiring: `npm start`
2) Yangi terminal:  
   ```bash
   ngrok http 3000
   ```
3) Ngrok bergan `https://...` URL ni `.env` dagi `BASE_URL` ga yozing.
4) Botni qayta ishga tushiring (`npm run bot`).

## 6) Telegram bot button / webapp sozlash

- Botda `/start` bosilganda “Testni boshlash” web_app tugmasi chiqadi.
- Web App URL: `${BASE_URL}/webapp`

## 7) Development (initData bo‘lmasa)

Telegram ichida emas (brauzerda) test qilish uchun:

- `NODE_ENV=development` qilib ishga tushiring:
  ```bash
  npm run dev
  ```
- `.env` da `DEV_TELEGRAM_ID` qo‘ying.

> TODO: Production’da doim Telegram `initData` tekshirilsin.

## 8) Browser orqali login (Telegram Login Widget)

Agar saytingizni Telegram’dan tashqarida (oddiy brauzerda) ochsangiz, u `login.html` sahifaga yo‘naltiradi.
U yerda Telegram Login Widget orqali kirib, keyin `webapp` ochiladi.

## 9) Deploy (Docker)

Serverda Docker o‘rnatilgan bo‘lsa:

1) `.env` ni to‘ldiring (`BASE_URL` domeningizning `https://...` ko‘rinishi bo‘lsin)
2) Deploy:
   ```bash
   ./deploy.sh
   ```

Containerlar:
- `web` — Express server (`3000` port)
- `bot` — Telegram bot (long polling)

> Nginx/reverse-proxy’ni o‘zingiz sozlaysiz: domeningizdan `3000` portga proxy qiling.
