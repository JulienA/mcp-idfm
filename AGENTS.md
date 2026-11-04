## Agent skills

### Issue tracker

Issues and specs live as markdown under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) on each issue’s `Status:` line. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/` when they exist. See `docs/agents/domain.md`.

## Cursor Cloud specific instructions

`npm test` fakes the PRIM adapters, so it needs neither `PRIM_API_KEY` nor network. `npm start` reads `.env` when that file exists and exits if `PRIM_API_KEY` is empty. With a key it listens on `0.0.0.0` (`HOST` / `PORT`, default `localhost:3000`) after one Info Trafic fetch; a rejected key still listens and Info Trafic stays empty until a snapshot succeeds. `GET /health` and `POST /mcp` are the running checks. A present `Origin` header must match `HOST`.
