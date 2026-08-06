# X Agent — kratak kontekst

`@AlphaGuruReal` je mali X nalog o Bitcoinu, tržištima i AI-ju.

Daily bot uzima aktuelne BTC podatke sa CoinGecko, pravi numerički proverene kandidate i 7-day chart, pa ih šalje Marku na Telegram. Kandidati 1/2 su text-only, kandidat 3 ide sa slikom. Daily Telegram tok objavljuje samo ručno odobren kandidat u roku od 24 sata.

Generator poredi kandidate sa skorijim X objavama, odbacuje slične formulacije i bira tri različita ugla. Ako Claude ne vrati validan skup, koristi se lokalni fallback od osam formata koji se rotiraju po datumu.

Reply agent je trenutno manual-only GitHub Action. Predlozi takođe zahtevaju Telegram odobrenje.

Auto fallback radi kroz GitHub Actions u 19:00 po Beogradu svakog drugog dana. Ako nalog nema objavu u prethodna 24 sata, objavljuje najbolji provereni text kandidat; nikada automatski ne objavljuje sliku.

Prioriteti:

1. Rotirati ranije procureli Telegram token.
2. Postaviti `TELEGRAM_WEBHOOK_SECRET` i ponovo registrovati webhook sa `secret_token` parametrom.
3. Ručno testirati image kandidat 3.
4. Ručno testirati reply/quote tok.
5. Tek posle provere kvaliteta razmotriti češće reply pokretanje.

Detalji su u `project-overview.md`.
