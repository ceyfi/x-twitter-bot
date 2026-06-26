# Alpha Guru — Twitter Bot — Project Overview

## Cilj projekta

Automatizovani Twitter bot koji svaki dan objavljuje postove na nalogu @AlphaGuruReal bez ručnog rada. Bot simulira stvarnu osobu koja prati tržišta, kripto i AI — ne zvuči kao bot, ne ponavlja se, ima izgrađen identitet.

Drugi deo: Reply agent koji pronalazi relevantne tweetove, generiše odgovore i šalje na Telegram na odobrenje.

---

## Tech stack

| Komponenta | Tehnologija |
|---|---|
| Hosting | Vercel (Hobby plan, besplatno) |
| Cron job (post) | Vercel Cron Jobs |
| Cron job (reply) | GitHub Actions |
| AI za pisanje | Claude API — claude-opus-4-5 |
| Twitter objava | Twitter API v2 (twitter-api-v2 npm) |
| Slike | @napi-rs/canvas (Canvas API, server-side) |
| Odobravanje | Telegram Bot (@alphaguru_approvals_bot) |
| Repo | https://github.com/ceyfi/x-twitter-bot |
| Runtime | Node.js ESM modules |

### Troškovi
- Vercel: besplatno
- Twitter API: Pay Per Use (~$5 kredita, traje godinama za 1 post/dan)
- Claude API: ~$0.01-0.02 po postu
- GitHub Actions: besplatno (2000 min/mesec)
- Telegram: besplatno

---

## Deo 1: Daily post bot

### Kako radi

1. Vercel Cron Job poziva `/api/post-tweet` svaki dan u **9:00 UTC (11:00 CET)**
2. Handler autentifikuje zahtev putem `CRON_SECRET` Bearer tokena
3. Povlači poslednjih **20 tweetova** sa naloga (anti-repetition)
4. Nasumično bira **temu**, **format** i **dužinu**
5. Šalje prompt Claude-u
6. Claude generiše tweet koji zvuči kao pravi čovek
7. **20% šansa za sliku** — generiše PNG grafiku (crna + zlatna) i postuje uz tekst
8. Tweet se objavljuje na Twitter v2 API

Ručno pokretanje:
```powershell
Invoke-WebRequest -Uri "https://x-twitter-bot.vercel.app/api/post-tweet" -Headers @{Authorization="Bearer <CRON_SECRET>"} | Select-Object -ExpandProperty Content
```

### Identitet — Alpha Guru

Bot uvek piše kao `@AlphaGuruReal` — osoba koja trguje kriptom godinama, prati makro.

**5 core tema:** Likvidnost · Psihologija tržišta · AI i white collar rad · Bitcoin · Narativni ciklusi

**10 formata:** Observation · Question · Contrarian take · Prediction · Mistake learned · Short story · Unpopular opinion · Mental model · One sentence insight · Comparison

**4 dužine:** Very short (<80 char) · One sentence · Two to three sentences · Question only

**Anti-repetition:** Povlači poslednjih 20 tweetova i šalje Claude-u.

**Banned phrases:** smart money, zoom out, wagmi, DYOR, to the moon, gm, itd.

---

## Deo 2: Reply agent sa Telegram odobravanjem

### Kako radi

1. GitHub Actions pokreće `reply-agent.js` **svakih 4 sata** (8, 12, 16, 20 UTC)
2. Agent traži relevantne tweetove (bitcoin, AI, markets) od naloga sa 500+ followera
3. Uzima top 3 po likes
4. Claude generiše odgovor u Alpha Guru stilu za svaki
5. Šalje na Telegram sa **inline dugmadima: ✅ Pošalji / ❌ Skip**
6. Korisnik tapne dugme u Telegramu
7. Telegram šalje callback na Vercel webhook `/api/telegram-webhook`
8. Webhook parsira odgovor iz poruke i postuje reply na Twitter

### Setup (jednom)

**GitHub Secrets** (Settings → Secrets → Actions):
- `TELEGRAM_BOT_TOKEN` = `8911496302:AAG_j4xA0rz75yZDzA8iEa9HJwjmubVXAns`
- `TELEGRAM_CHAT_ID` = `6304760850`

**Vercel env** (već postavljeno ako su ostale varijable tu):
- `TELEGRAM_BOT_TOKEN` i `TELEGRAM_CHAT_ID` (za webhook)

**Registruj Telegram webhook** (jednom, u browser ili PowerShell):
```
https://api.telegram.org/bot8911496302:AAG_j4xA0rz75yZDzA8iEa9HJwjmubVXAns/setWebhook?url=https://x-twitter-bot.vercel.app/api/telegram-webhook
```

---

## Fajlovi

```
x-twitter-bot/
├── api/
│   ├── post-tweet.js          # Daily post — generisanje + objava
│   └── telegram-webhook.js    # Prima callback od Telegrama, postuje reply
├── .github/
│   └── workflows/
│       └── reply-agent.yml    # GitHub Actions cron svakih 4h
├── reply-agent.js             # Traži tweetove, generiše reply, šalje na Telegram
├── vercel.json                # Vercel cron config
├── package.json               # Dependencies (ESM)
├── kontekst.md                # Kratki kontekst
└── project-overview.md        # Ovaj fajl
```

---

## Environment variables

### Vercel
| Varijabla | Opis |
|---|---|
| TWITTER_CONSUMER_KEY | Twitter app consumer key |
| TWITTER_CONSUMER_SECRET | Twitter app consumer secret |
| TWITTER_ACCESS_TOKEN | OAuth access token |
| TWITTER_ACCESS_SECRET | OAuth access token secret |
| ANTHROPIC_API_KEY | Claude API ključ |
| CRON_SECRET | Auth token za ručno pokretanje |
| TELEGRAM_BOT_TOKEN | Bot token za webhook |
| TELEGRAM_CHAT_ID | Tvoj chat ID za webhook |

### GitHub Secrets (isti + Telegram)
Sve gore + `TELEGRAM_BOT_TOKEN` i `TELEGRAM_CHAT_ID`

---

## Šta je urađeno

- [x] Vercel `/api/post-tweet` — dnevni post
- [x] Vercel Cron Job — 9:00 UTC daily
- [x] Claude opus-4-5 integracija
- [x] Twitter API v2 — objava
- [x] Alpha Guru persona — 5 tema, 10 formata, 4 dužine
- [x] Anti-repetition (poslednih 20 tweetova)
- [x] Banned phrases, varijacija openinga
- [x] Slike uz postove — @napi-rs/canvas, crna+zlatna grafika, 20% šansa
- [x] Reply agent — `reply-agent.js`
- [x] GitHub Actions cron — svakih 4h
- [x] Telegram bot integracija — inline keyboard ✅/❌
- [x] Vercel webhook — `/api/telegram-webhook` postuje reply

## Šta nedostaje

- [ ] Setup Telegram webhook (jednom) — vidi Setup iznad
- [ ] Dodati `TELEGRAM_BOT_TOKEN` i `TELEGRAM_CHAT_ID` u Vercel env
- [ ] Dodati `TELEGRAM_BOT_TOKEN` i `TELEGRAM_CHAT_ID` u GitHub Secrets
- [ ] 2 posta dnevno umesto 1
- [ ] Metrike — pratiti koji formati dobijaju najviše engagementa
