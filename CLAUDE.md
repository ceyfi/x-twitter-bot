# Claude Working Memory

## Korisnik
- Marko, Windows korisnik
- Koristi PowerShell — `&&` NE RADI, uvek davati komande odvojeno

## Projekat: Alpha Guru Twitter Bot
- Repo: https://github.com/ceyfi/x-twitter-bot
- Vercel: https://x-twitter-bot.vercel.app
- Twitter nalog: @AlphaGuruReal
- Telegram bot: @alphaguru_approvals_bot (token u env)
- Telegram Chat ID: 6304760850

## Tech
- Node.js ESM (type: "module" u package.json)
- twitter-api-v2, @anthropic-ai/sdk, sharp
- OAuth 1.0a (ne OAuth 2.0)

## Prioritet sada
- Rotirati kompromitovani Telegram token.
- Postaviti `TELEGRAM_WEBHOOK_SECRET` i ponovo registrovati sigurni webhook.
- Deployovati i testirati generate → Telegram approval → X post tok.

> Globalna pravila su u `~/.claude/CLAUDE.md`. Pun kontekst: `HANDOFF.md` u ovom folderu.
