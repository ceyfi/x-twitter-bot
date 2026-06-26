# HANDOFF — X AGENT (Twitter bot @AlphaGuruReal)
**Datum handoff-a: 11. jun 2026** · Pregled celog koda urađen 11.6.2026.

## Šta projekat radi
Bot koji jednom dnevno (9:00 UTC, Vercel Cron) generiše tweet preko Claude API-ja (claude-opus-4-5) i objavljuje ga kroz Twitter API v2. Identitet: "Alpha Guru" — trader persona, lowercase stil, bez klišea.

## Šta je urađeno (stanje 11.6.2026)
- **`api/post-tweet.js` (149 linija) — aktivna, finalna verzija.** Vercel serverless ruta: CRON_SECRET autorizacija, povlači poslednjih 20 tweetova (anti-ponavljanje), nasumično bira temu (5), format (10) i dužinu (4), Claude generiše, Twitter v2 objavljuje. Dobar error handling sa kodom i podacima u odgovoru.
- **Prompt inženjering je najjači deo projekta:** banned phrases (15 klišea), varijacija openinga, persona sa specifičnim opsesijama — ovo daje tweete koji ne zvuče kao bot.
- **`post-tweet.js` u root-u (106 linija) — STARA verzija** koja je objavljivala kroz Playwright browser login (klik po koordinatama ekrana!). Prevaziđena prelaskom na API.
- Dokumentacija solidna: `kontekst.md` + `project-overview.md`.

## Ocena koda: aktivni deo 8/10, repo kao celina 5/10 zbog mrtvog koda

### 🔴 Problemi
1. **GitHub Actions workflow je mrtav i potencijalno opasan.** `.github/workflows/` i dalje poziva staru Playwright verziju, takođe u 9:00 UTC. Dva problema: (a) ako bi ikad proradio, imao bi dupli post u isto vreme kad i Vercel cron; (b) trenutno je sigurno slomljen jer `playwright` uopšte nije u `package.json` dependencies — `import { chromium } from "playwright"` pada. Uz to, workflow koristi `TWITTER_EMAIL`/`TWITTER_PASSWORD` secrets — login kredencijali u Actions su nepotreban rizik kad API verzija radi.
   **Fix: obrisati `.github/workflows/` ceo, obrisati root `post-tweet.js`, obrisati `screenshot.png`, i ukloniti TWITTER_EMAIL/PASSWORD iz GitHub secrets.**
2. **Nekonzistentna dokumentacija:** `kontekst.md` kaže nalog @GuruTheWitcher (+ "potreban rebranding"), `project-overview.md` kaže @AlphaGuruReal. Ostaviti samo jedan fajl sa tačnim stanjem.

### Manje stvari
3. `getRecentTweets()` guta sve greške (`catch { return [] }`) — ako Twitter read padne, bot i dalje postuje, ali bez anti-repeat konteksta i bez ikakvog loga. Dodati `console.warn`.
4. Nema zaštite od dužine — Claude može vratiti tekst > 280 karaktera i objava pada sa 403. Dodati: ako je `tweetText.length > 280`, skratiti ili regenerisati.
5. Claude ponekad vrati tekst pod navodnicima — dodati `.replace(/^"|"$/g, '')`.
6. `model: "claude-opus-4-5"` hardkodiran — izvući u env var da promena modela ne traži deploy.

## Savet za dalje
1. Očisti mrtav kod (tačka 1) — to je 10 minuta posla i repo postaje jednostavan: 1 API fajl + 2 configa.
2. Sledeći realan upgrade po vrednosti: **ubaci aktuelnost** — pre generisanja povući BTC cenu (CoinGecko, besplatno) ili 1-2 naslova iz crypto RSS-a i dati Claude-u kao opcioni kontekst. Persona postaje "u toku", a ne vanvremenska.
3. Loguj objavljene tweete (Vercel KV ili samo append u GitHub gist) — za praćenje šta radi i analizu engagement-a kasnije.
4. Ne dodavati framework, bazu, ni dashboard — jedan serverless fajl je tačna veličina ovog projekta.

## Kako se pokreće
- Automatski: Vercel Cron 9:00 UTC (`vercel.json`)
- Ručno: `Invoke-WebRequest -Uri "https://x-twitter-bot.vercel.app/api/post-tweet" -Headers @{Authorization="Bearer <CRON_SECRET>"}`
- Env (Vercel): TWITTER_CONSUMER_KEY/SECRET, TWITTER_ACCESS_TOKEN/SECRET, ANTHROPIC_API_KEY, CRON_SECRET
