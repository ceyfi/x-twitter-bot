# HANDOFF — X Agent

## Trenutno stanje

Aktivni sistem je Node.js ESM projekat na Vercelu za `@AlphaGuruReal`.

- `api/post-tweet.js`: Vercel cron uzima live BTC podatke, generiše tri proverena predloga i 7-day PNG chart, pa ih šalje u jednoj Telegram poruci. Kandidat 3 je image post. Ne objavljuje automatski.
- `api/telegram-webhook.js`: proverava Telegram secret header i chat ID; kandidat 3 preuzima Telegram photo i uploaduje je na X, kandidati 1/2 su text-only, a odobren reply-agent kandidat je quote tweet.
- `reply-agent.js`: traži aktuelne objave i šalje samo konkretne predloge; GitHub workflow je manual-only.
- Stari Playwright poster, screenshot i njegov workflow su uklonjeni.

## Obavezno pre deploya

1. Rotirati Telegram bot token preko BotFather-a. Stari token je bio commitovan i mora se smatrati kompromitovanim.
2. Popuniti sve varijable iz `.env.example` u Vercelu.
3. Pokrenuti `npm run telegram:webhook` sa novim tokenom i `TELEGRAM_WEBHOOK_SECRET` u lokalnom environmentu.
4. U GitHub secrets ukloniti stare `TWITTER_EMAIL` i `TWITTER_PASSWORD` vrednosti.

## Namerno nije urađeno

- Nema baze, dashboarda ni dodatnog frameworka.
- Nema automatskog daily posta bez čoveka.
- Reply cron nije uključen dok se ručno ne potvrde kvalitet i X API trošak.
- Nema izmišljenih ličnih iskustava u promptovima.

## Verifikacija

Pokrenuti syntax check:

```powershell
node --check api/post-tweet.js
node --check api/telegram-webhook.js
node --check reply-agent.js
```

Zatim deployovati i ručno pozvati `/api/post-tweet` sa validnim Bearer `CRON_SECRET`. Očekivanje: jedna Telegram poruka sa tri kandidata i chart previewom; samo kandidat 3 objavljuje sliku.
