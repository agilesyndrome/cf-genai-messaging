# Architecture

This repository is the starting point for a composable Cloudflare Worker
feature module. A feature owns one capability end to end: its middleware,
route handlers, binding expectations, schemas, migrations, and API client
helpers. The consuming site supplies the Cloudflare bindings and layers the
feature into cf-genai-base.

## Runtime contract

The module exports a feature object with middleware:

    middleware(request, env, ctx, next, state)

Middleware may short-circuit a route or call next(). Request-scoped values
belong in state; module-level state must never contain request data. Binding
access stays inside request handlers and uses Cloudflare in-process bindings.

## Repository layout

- src/index.js: public feature factory and runtime contract.
- tests/: unit tests for routing and feature behavior.
- CONTRACT.md: stable integration promises.
- @agilesyndrome/cf-genai-cli: shared local project and release lifecycle.
- .github/workflows/build.yml: test/build gate.
- .github/workflows/publish.yml: tag-driven npm Trusted Publishing.

## Build and release

    npx --yes @agilesyndrome/cf-genai-cli@0.1.3 ci
    npx --yes @agilesyndrome/cf-genai-cli@0.1.3 release

The CLI release command creates the matching v* tag and pushes it; GitHub
Actions publishes to npm with OIDC provenance. Feature-owned migrations should
be additive and versioned with the feature. Publish a feature only after its
required base package version is available.
