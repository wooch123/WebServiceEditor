# ADR 0001: Local Vite/Fastify/SQLite architecture

Status: accepted

## Context

The product must run on a user's Windows PC, preserve project-isolated SQLite
files, support transactional recycle-bin operations, and be reachable through
an outbound Cloudflare Tunnel.

## Decision

Use a pnpm monorepo with a React/Vite SPA and separate Fastify service. Keep a
metadata SQLite database and distinct test/production SQLite databases per
project. Bind the production service to `127.0.0.1` only.

## Consequences

Cloudflare Worker/D1-only hosting is not the production architecture. Static
web assets may be served by Fastify in production. Windows service and tunnel
verification remain Phase 22 work.
