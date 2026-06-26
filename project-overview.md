# Alpha Guru — Twitter Bot — Project Overview

## Cilj projekta

Automatizovani Twitter bot koji svaki dan objavljuje postove na nalogu @AlphaGuruReal bez ručnog rada. Bot simulira stvarnu osobu koja prati tržišta, kripto i AI — ne zvuči kao bot, ne ponavlja se, ima izgrađen identitet.

---

## Tech stack

| Komponenta | Tehnologija |
|---|---|
| Hosting | Vercel (Hobby plan, besplatno) |
| Cron job | Vercel Cron Jobs |
| AI za pisanje | Claude API — claude-opus-4-5 (Anthropic) |
| Twitter objava | Twitter API v2 (twitter-api-v2 npm paket) |
| Repo | https://github.com/ceyfi/x-twitter-bot |
| Runtime | Node.js (ESM modules) |

### Troškovi
- Vercel: besplatno
- Twitter API: Pay Per Use (~$5 kredita, traje godinama za 1 post/dan)
- Claude API: ~$0.01-0.02 po postu (Anthropic console)

---

## Kako app radi

1. Vercel Cron Job poziva `/api/post-tweet` svaki dan u **9:00 UTC (11:00 CET)**
2. Handler autentifikuje zahtev putem `CRON_SECRET` Bearer tokena
3. Povlači poslednjih **20 tweetova** sa naloga (da se ne ponavlja)
4. Nasumično bira **temu**, **format** i **dužinu** posta
5. Šalje prompt Claude-u sa svim kontekstom
6. Claude generiše tweet koji zvuči kao pravi čovek
7. Tweet se objavljuje na Twitter v2 API

Bot se može i ručno pokrenuti:
```powershell
Invoke-WebRequest -Uri "https://x-twitter-bot.vercel.app/api/post-tweet" -Headers @{Authorization="Bearer <CRON_SECRET>"} | Select-Object -ExpandProperty Content
```

---

## Funkcionalnosti

### Identitet — Alpha Guru
Bot uvek piše kao `@AlphaGuruReal` — osoba koja trguje kriptom godinama, prati makro, opsednuta je likvidnošću i psihologijom tržišta.

### 5 core tema (CORE_THEMES)
- Likvidnost i kako ona pokreće sve
- Psihologija tržišta i ponašanje gomile
- AI adopcija i uticaj na white collar rad
- Bitcoin
- Kako se narativni formiraju i urušavaju

### 10 formata (FORMATS)
- Observation
- Question (provocira razmišljanje)
- Contrarian take
- Prediction
- Mistake learned
- Short story (jedna rečenica)
- Unpopular opinion
- Mental model
- One sentence insight (brutalno kratko)
- Comparison

### 4 dužine (LENGTHS)
- Very short (ispod 80 karaktera)
- One sentence
- Two to three sentences
- Question only

### Anti-repetition
Bot povlači poslednjih 20 tweetova i šalje ih Claude-u sa instrukcijom da ne ponavlja ideje, teme ni formulacije.

### Banned phrases
Lista od 15 kripto/market klišea koje bot nikad ne koristi (smart money, zoom out, wagmi, DYOR, to the moon, itd.)

### Varijacija openinga
Claude ima instrukciju da ne počinje svaki tweet sa "I think", "Feels like", "Most people", "Everyone", "The market".

---

## Fajlovi

```
x-twitter-bot/
├── api/
│   └── post-tweet.js     # Glavna logika — generisanje + objava
├── vercel.json           # Cron job konfiguracija (9:00 UTC daily)
├── package.json          # Dependencies
├── kontekst.md           # Kratki kontekst projekta
└── project-overview.md   # Ovaj fajl
```

---

## Environment variables (Vercel)

| Varijabla | Opis |
|---|---|
| TWITTER_CONSUMER_KEY | Twitter app consumer key |
| TWITTER_CONSUMER_SECRET | Twitter app consumer secret |
| TWITTER_ACCESS_TOKEN | OAuth access token (@AlphaGuruReal) |
| TWITTER_ACCESS_SECRET | OAuth access token secret |
| ANTHROPIC_API_KEY | Claude API ključ |
| CRON_SECRET | Auth token za ručno pozivanje |

---

## Šta je urađeno

- [x] Vercel API endpoint `/api/post-tweet`
- [x] Vercel Cron Job — automatsko pokretanje svaki dan u 9:00 UTC
- [x] Claude opus-4-5 integracija za generisanje teksta
- [x] Twitter API v2 integracija za objavu
- [x] Identitet — Alpha Guru persona u system promptu
- [x] 5 core tema, 10 formata, 4 dužine — nasumičan izbor
- [x] Anti-repetition — povlači poslednjih 20 tweetova
- [x] Banned phrases lista
- [x] Varijacija sentence openings
- [x] OAuth autentifikacija za ručno pokretanje
- [x] Rebranding naloga — bio, ime (Alpha Guru @AlphaGuruReal)
- [x] AG logo dizajn (SVG, crna + zlatna)

---

## Šta nedostaje

- [ ] Slike uz postove (20% šansa) — šablon sa AG logom + tekst
- [ ] 2 posta dnevno umesto 1
- [ ] Reply na sopstveni tweet (mini thread)
- [ ] Praćenje metrika (impressions, likes po formatu) da se favorizuju bolji formati
- [ ] Weighted format selection — više question/contrarian ako dobijaju više reakcija

---

## Sledeći koraci (prioritetno)

1. **Slike** — napraviti AG šablon (crna pozadina, zlatna tipografija) i automatski generisati image uz ~20% tweetova
2. **2 posta dnevno** — dodati drugi cron u 15:00 UTC
3. **Metrike** — pratiti koji formati dobijaju najviše engagement-a i težinski ih favorizovati
