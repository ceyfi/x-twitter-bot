# X Agent — kratak kontekst

`@AlphaGuruReal` je mali X nalog o Bitcoinu, tržištima i AI-ju.

Daily bot uzima BTC chart, osam većih non-stable coina i globalni market snapshot sa CoinGecko. Kandidat 1 je market insight sa jasnim zaključkom, kandidat 2 proverljiv setup, a kandidat 3 priča iz BTC charta i ide sa slikom. Daily Telegram tok objavljuje samo ručno odobren kandidat u roku od 24 sata.

Generator poredi teme sa skorijim X objavama. Claude samo preformuliše fact-locked draftove; ako promeni činjenicu ili omane format, fallbackuje samo taj kandidat na provereni market brief.

Reply agent je trenutno manual-only GitHub Action. Predlozi takođe zahtevaju Telegram odobrenje.

Auto fallback radi kroz GitHub Actions u 19:00 po Beogradu svakog drugog dana. Ako nalog nema objavu u prethodna 24 sata, objavljuje najbolji provereni text kandidat samo kada tržište ima signal score >= 2; slab dan preskače. Nikada automatski ne objavljuje sliku.

Prioriteti:

1. Rotirati ranije procureli Telegram token.
2. Postaviti `TELEGRAM_WEBHOOK_SECRET` i ponovo registrovati webhook sa `secret_token` parametrom.
3. Ručno testirati image kandidat 3.
4. Ručno testirati reply/quote tok.
5. Tek posle provere kvaliteta razmotriti češće reply pokretanje.

Detalji su u `project-overview.md`.
