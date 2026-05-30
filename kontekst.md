# Twitter Bot — Kontekst projekta

## Šta je ovo?
Automatizovani Twitter bot koji svaki dan objavljuje postove na nalogu bez ručnog rada.

## Kako radi?
1. **Vercel Cron Job** pokreće API endpoint svaki dan u 9:00 UTC (11:00 CET)
2. **Claude AI** (claude-opus-4-5) generiše post koji zvuči kao pravi čovek
3. **Twitter API v2** objavljuje post na nalogu

## Teme postova
- Crypto trendovi / Bitcoin / Ethereum price action
- Novosti iz sveta veštačke inteligencije
- Berza / makroekonomija (Fed, inflacija, earnings)
- DeFi / Web3
- Kontrarni stavovi o investiranju / trading psihologija

## Ton / stil
Casual, direktan, kao da piše stvarna osoba koja prati tržišta godinama.
Bez spam hashtagova, bez emojija osim ako pristaju, kratke rečenice.

## Nalog
- Twitter: @GuruTheWitcher
- Status: potreban rebranding (bio, profilna, ime)

## Predlog rebrandinga
**Bio:** *trading crypto since the bear. mostly wrong, occasionally right. thoughts on markets, AI, and what's next.*

## Tech stack
- Hosting: Vercel (Hobby plan, besplatno)
- AI: Claude API (Anthropic) — plaća se po korišćenju, ~$0.01/dan
- Twitter API: Pay Per Use ($5 kredita kupljeno, traje godinama)
- Repo: https://github.com/ceyfi/x-twitter-bot

## Env varijable (Vercel)
- TWITTER_CONSUMER_KEY
- TWITTER_CONSUMER_SECRET
- TWITTER_ACCESS_TOKEN
- TWITTER_ACCESS_SECRET
- ANTHROPIC_API_KEY
- CRON_SECRET = marko-bot-2024

## Fajlovi
- `api/post-tweet.js` — glavna logika (generisanje + objavljivanje)
- `vercel.json` — cron job konfiguracija
- `package.json` — dependencies
