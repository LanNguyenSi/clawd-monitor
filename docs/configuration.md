# Configuration

Environment variables read by the server (`server.ts` and the Next.js API
routes). See `.env.example` for a copyable template.

```env
# Required
ADMIN_PASSWORD=             # plaintext, or use ADMIN_PASSWORD_HASH (bcrypt)
JWT_SECRET=                 # random 32+ char string

# Optional
AGENT_TOKENS=token1,token2  # static tokens (also manageable via Settings UI)
AGENT_TTL_MS=300000         # offline-agent TTL in ms (default 5min)
NEXT_PUBLIC_DEFAULT_GATEWAY_URL=http://localhost:9500
DEFAULT_GATEWAY_TOKEN=      # default OpenClaw API token
ALLOWED_GATEWAY_HOSTS=      # SSRF allowlist for per-instance gateway overrides (comma-separated hostnames)
CLAWD_DIR=/root/.openclaw/workspace  # Memory Viewer source (MEMORY.md / CURRENT.md / memory/*.md); code default when unset is /root/clawd
CLAWD_MONITOR_DATA_DIR=/data   # persistent storage for tokens + password hash
DOMAIN=monitor.yourdomain.com  # used by docker-compose.traefik.yml
GITHUB_TOKEN=               # for GitHub PR widget
```

Notes:

- `ADMIN_PASSWORD` is compared as plaintext. Set `ADMIN_PASSWORD_HASH` instead
  (a bcrypt hash) if you prefer not to store the plaintext password in the
  environment; use the matching plaintext password to log in.
- After the first login, use `Settings` in the UI to change the admin
  password; that change is persisted in `CLAWD_MONITOR_DATA_DIR` and becomes
  the active login password (it takes precedence over the env var on
  subsequent logins).
- `ALLOWED_GATEWAY_HOSTS` overrides must be `https` and may not point at
  private or loopback IPs; leave it empty to forbid all per-instance
  overrides and use only the default gateway.
- Agent tokens can also be issued and revoked from the Settings UI instead of
  the static `AGENT_TOKENS` list.
