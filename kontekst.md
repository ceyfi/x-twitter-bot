# X Agent — kratak kontekst

`@AlphaGuruReal` je mali X nalog o Bitcoinu, tržištima i AI-ju.

Daily bot ne objavljuje sam. Uzima aktuelne BTC podatke sa CoinGecko, pravi tri konkretna kandidata i 7-day chart, pa ih šalje Marku na Telegram. Kandidati 1/2 su text-only, kandidat 3 ide sa slikom. Objavljuje se samo ručno odobren kandidat.

Reply agent je trenutno manual-only GitHub Action. Predlozi takođe zahtevaju Telegram odobrenje.

Prioriteti:

1. Rotirati ranije procureli Telegram token.
2. Postaviti `TELEGRAM_WEBHOOK_SECRET` i ponovo registrovati webhook sa `secret_token` parametrom.
3. Deploy na Vercel i ručno testiranje jednog daily kandidata.
4. Tek posle provere kvaliteta razmotriti češće reply pokretanje.

Detalji su u `project-overview.md`.
