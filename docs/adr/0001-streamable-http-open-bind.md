# Streamable HTTP on 0.0.0.0, Origin allowlist, no MCP token

The MCP is a remote-capable HTTP server (Streamable HTTP, `POST /mcp`), not stdio. It binds `0.0.0.0` with `HOST` and `PORT` in env so a reverse proxy or LAN client can reach it, and it does not authenticate callers: the only credential is `PRIM_API_KEY` for Île-de-France Mobilités. Origin is validated against `HOST` when the header is present; clients with no Origin (Cursor, Claude) are allowed. A future public exposure should reopen this: without a token, anyone who can hit the port can spend the PRIM quota.

## Considered Options

- Local stdio: simpler and safer, rejected because the server must be reachable over HTTP.
- Localhost-only bind: safer default in the MCP spec, rejected because we need a configured host on all interfaces.
- MCP bearer/API key: rejected for v1; caller auth stays off.
