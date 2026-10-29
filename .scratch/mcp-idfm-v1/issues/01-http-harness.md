# 01: HTTP harness

**What to build:** An operator can start the MCP over Streamable HTTP. Without `PRIM_API_KEY` the process exits immediately. With the key it listens on `0.0.0.0` at `HOST`/`PORT`, accepts `POST /mcp` (handshake), rejects a mismatched Origin, allows clients with no Origin, and answers `GET /health` with `{ ok, trafic_updated_at, stale }`. No métier tools yet.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Missing `PRIM_API_KEY` causes a non-zero exit at boot
- [x] With a key, the server binds `0.0.0.0` and serves Streamable HTTP on `POST /mcp`
- [x] Origin present and not matching `HOST` is rejected; missing Origin is allowed
- [x] `GET /health` returns `{ ok, trafic_updated_at, stale }` (snapshot fields may be empty/null until ticket 03)
- [x] Application-seam tests cover fail-fast and health; HTTP is not the product test surface

## Answer

Streamable HTTP harness with `PRIM_API_KEY` fail-fast, Origin allowlist, and `GET /health` is on `feat/mcp-idfm-v1` (`b5d28ac`).

## Comments

Implemented on `feat/mcp-idfm-v1` (`be76a7a`).
Review fixes merged (`b5d28ac`).
