# Alpha Guru — project overview

Mali serverless sistem koji priprema konkretne X objave za `@AlphaGuruReal` i traži ručno Telegram odobrenje pre objavljivanja.

## Daily tok

1. Vercel cron poziva `GET /api/post-tweet` u 09:00 UTC.
2. Endpoint proverava obavezni `CRON_SECRET`.
3. CoinGecko daje BTC 7d chart, podatke za osam većih non-stable coina i globalni crypto market snapshot.
4. Kod bira dve različite teme: BTC/ETH relative strength, market breadth, leader/laggard dispersion, lider među majorima, ukupni market cap, BTC dominance ili market-wide turnover. Treći predlog je vezan za BTC chart.
5. Claude dobija tri fact-locked drafta i sme samo da poboljša formulaciju. Ne sme da menja ili dodaje broj, asset, poređenje ili timeframe.
6. Lokalna validacija proverava svaki Claude kandidat zasebno. Nevalidan kandidat se pojedinačno vraća na svoj provereni market brief, umesto da ceo paket padne na isti fallback ciklus.
7. Sva tri predloga i preview 7-day BTC charta stižu u jednoj Telegram poruci, uz oznaku da li ih je izabrao Claude ili rotirajući fallback.
8. Kandidati 1 i 2 su text-only. Kandidat 3 je napisan uz chart i objavljuje se sa slikom.
9. Dugme **Objavi 1/2/3** šalje jedan izabrani post na X i uklanja sva dugmad.
10. Telegram odobrenje važi 24 sata. Greška daily ciklusa šalje upozorenje u isti chat.

## Reply/quote tok

`reply-agent.js` se trenutno pokreće samo ručno kroz GitHub Actions. Pretražuje aktuelne X objave, bira relevantne i šalje konkretne predloge na Telegram. Ako model nema koristan odgovor, vraća `SKIP` i ništa se ne šalje.

Odobrena reakcija se trenutno objavljuje kao quote tweet, ne kao direktan reply.

## Automatski fallback

GitHub Action pokreće proveru u 19:00 po vremenu `Europe/Belgrade`, uz automatsko
prilagođavanje letnjem/zimskom računanju vremena. Svakog drugog dana, počev od
2026-08-02, proverava X timeline. Ako postoji objava u prethodna 24 sata, ne radi
ništa. Ako je nema, uzima sveže podatke i automatski objavljuje samo najbolji
provereni text kandidat. I ovaj tok koristi istoriju objava za anti-repeat;
greška X timeline provere prekida objavu (fail closed).

## Sigurnost

- Svi ključevi su isključivo u Vercel/GitHub secrets.
- `CRON_SECRET` je obavezan; endpoint ne postaje javan ako varijabla nedostaje.
- Telegram webhook proverava `X-Telegram-Bot-Api-Secret-Token` i dozvoljeni chat ID.
- Stari Telegram token iz git istorije mora biti rotiran preko BotFather-a.
- Posle rotacije ukloniti stare `TWITTER_EMAIL` i `TWITTER_PASSWORD` GitHub secrets.

## Environment variables

### Vercel

- `TWITTER_CONSUMER_KEY`
- `TWITTER_CONSUMER_SECRET`
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_SECRET`
- `ANTHROPIC_API_KEY` — opciono; bez njega rade provereni market briefovi bez Claude preformulisanja
- `ANTHROPIC_MODEL` — opciono; default je `claude-sonnet-5`
- `CRON_SECRET`
- `TELEGRAM_BOT_TOKEN` — novi, rotirani token
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_WEBHOOK_SECRET` — 16–256 znakova: slova, brojevi, `_` i `-`

### GitHub Actions

Iste X, Anthropic i Telegram varijable koje koristi `reply-agent.js`.

## Registracija sigurnog Telegram webhooka

Posle postavljanja Vercel env varijabli lokalno postaviti novi token i secret u
environment, pa pokrenuti `npm run telegram:webhook`. Ako lokalne promenljive nisu
postavljene, skripta sama pita za token i secret. Vrednosti se ne upisuju u fajl ili Git.

`TELEGRAM_WEBHOOK_URL` je opciona; podrazumevani URL je produkcioni Vercel webhook.

## Fajlovi

```text
api/post-tweet.js             live podaci + 3 predloga + generisanje PNG charta
api/telegram-webhook.js       odobravanje, Telegram photo download i X media upload
lib/content-validation.js     validacija činjenica, market teme, parseri i 24h approval pravilo
test/content-validation.test.js
reply-agent.js                ručno traženje quote/reply prilika
auto-post.js                  svaki drugi dan: siguran text-only fallback
.github/workflows/reply-agent.yml
.github/workflows/auto-post-fallback.yml
vercel.json                   daily cron
```

## Trošak i ograničenja

Vercel, Telegram i CoinGecko endpoint mogu se koristiti besplatno u ovom obimu. PNG se lokalno renderuje kroz `sharp`; nema image-generation API troška. Claude i X API se plaćaju prema potrošnji. Sistem ne garantuje engagement; distribucija i dalje zavisi od kvalitetnih interakcija i izbora tema.
