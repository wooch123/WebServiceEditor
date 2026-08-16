# ADR 0019: Accessibility, security, performance, and actual-domain boundary

Status: accepted

## Decision

Phase 18 uses one production Fastify process bound to loopback. The process
serves the compiled SPA and `/api/v1` from the same origin. A named Cloudflare
Tunnel exposes only `https://webeditor.dove9999.com`; the application port is
not opened directly.

The public service requires one local administrator account. Passwords use
Argon2id. Authentication uses a short-lived opaque session stored only as a
SHA-256 digest. The session cookie is `Secure`, `HttpOnly`, `SameSite=Strict`,
and `__Host-` scoped. Every mutating API requires the matching readable CSRF
cookie, `x-csrf-token`, and exact HTTPS Origin. Login attempts are rate limited.
Credentials and tunnel tokens remain outside the repository; the administrator
credential is stored in the operating-system keychain.

Helmet owns CSP, HSTS, frame denial, MIME sniffing protection, and the referrer
policy. The browser never sends SQL or executable scripts. Existing route
validators, identifier allowlists, parameterized SQLite statements, path
containment, and symlink checks remain the data trust boundary.

Accessibility retains semantic controls, keyboard focus, 120 contrast-checked
themes, color-vision simulation, and reduced-motion CSS. Authentication is an
accessible boundary rather than a separate visual system.

Performance instrumentation is a bounded in-memory ring. It records normalized
Fastify route templates and percentile latency without request bodies, query
values, cookies, or credentials. Phase 18 gates the Chapter 27 list, search,
editor-open, and first-display budgets. The complete corpus and large-graph
matrix remain Phase 19.

The Phase 18 security release gate requires zero Critical or High defects.

## Consequences

- Local development may keep authentication disabled, but the actual-domain
  process must enable it.
- Static assets and API share the same origin, so production needs no permissive
  CORS policy.
- Restarting the public service requires the existing Metadata DB; the initial
  administrator password is needed only for first bootstrap.
- Tunnel availability is operational evidence and is not encoded as a secret in
  source control.
