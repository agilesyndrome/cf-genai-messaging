# `@agilesyndrome/cf-genai-base`

Opinionated startup boilerplate for small Cloudflare Workers.

The base owns the shared security boundary as well as Worker lifecycle concerns. It reserves `/admin` and `/api/admin` routes, authenticates them using `AUTH_STRATEGY` (default `http_basic`, or `oauth` when an auth provider is supplied), and applies the optional `authorize` policy. Sites still own their router, HTML, D1 queries, R2 keys, and scheduled jobs.
Use D1 bindings for durable application data and R2 bindings for binary assets;
do not put either into module-level state.

Base also provides provider-neutral authorization helpers and browser components
through `@agilesyndrome/cf-genai-base/authorization` and
`@agilesyndrome/cf-genai-base/ui`. Applications declare their scope manifest,
while base owns the user, scope, and grant records plus the generic user-access
API. The UI components are themeable with CSS custom properties and do not
contain application-specific components.

```js
import { createWorker, healthResponse } from "@agilesyndrome/cf-genai-base";

export default createWorker({
  features: [auth],
  fetch: async (request, env) => {
    if (new URL(request.url).pathname === "/health") return healthResponse(env);
    return router(request, env);
  },
});
```

Features expose `middleware(request, env, ctx, next, state)` and may short-circuit reserved routes, attach request state, or call `next()`.

Sites may provide `adminPage({ request, env, url, state, features })` to render
the shared platform pages (`/admin/users`, `/admin/scopes`, `/admin/groups`,
`/admin/features`, `/admin/healthchecks`, and `/admin/circuit-breakers`) inside
their own shell. The callback runs after the shared authorization boundary and
must return a `Response` or `null`.

Sites may separately provide `siteAdminPage({ request, env, url, state,
features })` for a `/admin/site/*` namespace. This is useful when a site wants
its own admin pages to have an explicit boundary beside the shared platform
pages.

The shared `<cf-admin-shell>` accepts an optional `cookbook-links` attribute
containing semicolon-separated `Label|URL|active-key` entries. This lets a site
replace the default Cookbook links while keeping the System links consistent.

## Shared platform helpers

`createWorker` can own `/health` and `/api/health`, run a boot validator before
requests, and optionally deliver server-side PostHog events. Use
`assertBoot(env, { bindings: ["DB"], required: ["AUTH_SESSION_SECRET"] })` in a
site initializer to fail closed when its Cloudflare configuration is incomplete.


## Core operational services

Apply `migrations/0002_core.sql` after the authorization migration. The package exports `registerHealthcheck`, `updateHealthcheck`, `registerCircuitBreaker`, `setCircuitBreaker`, and `evaluateCircuitBreaker` from `/cf-genai-base`. Healthchecks use `red`, `yellow` (unknown/transient), or `green`; breakers use `off`, `tripped`, or `on`, with `any` or `all` healthcheck evaluation. Automated evaluation may only move `on` to `tripped`, or self-healing `tripped` to `on`; admin API writes are the human control plane for the `off` state.

Admin APIs are `GET /api/admin/healthchecks`, `PUT /api/admin/healthchecks/:id`, `GET /api/admin/circuit-breakers`, `GET|PUT /api/admin/circuit-breakers/:id`, and `GET /api/admin/features`. The browser route `/admin/features` renders the same feature catalog for administrators. The catalog lists each installed runtime feature, its `packageName` and `version`, its most severe healthcheck state, all feature healthchecks, and its circuit breakers (including the feature roll-up breaker). Feature manifests may expose `healthchecks` and `circuitBreakers`; add `displayName`, `packageName`, and `version` to make the installation identity explicit. Use `createD1(env, { who })` for downstream D1 calls; it emits EventLog and AuditLog console records with the requesting actor.


## User administration

Apply `migrations/0004_tenants.sql` after the authorization migration to add
tenant membership and subscriptions. It creates the `Easley Family` tenant,
the `VIP` subscription, associates them, migrates all existing users into the
tenant, and keeps newly provisioned users attached to it.

Use the selected D1 target (local by default) to inspect and update users:

    cf-genai user list --target local
    cf-genai user get someone.com --target staging
    cf-genai user update someone.com --roles admin --target production

`user:get` also reports scopes and groups. The user update command resolves an email, subject, or internal id and supports `admin` or `none` roles. Production commands should be run through the repository credentials wrapper and reviewed as an administrative change.

## Scoped data access

Features may register D1 resources with `dataResources` and receive the
scoped reader on the request state as `state.data`. Resources declare `user`,
`tenant`, or `system` scope, their physical table, and an explicit column
allowlist. Use `state.data.tenant`, `state.data.user`, or `state.data.system`;
the reader applies ownership predicates, supports bounded native pagination via
page with limit/offset, count, and safe bulk updateWhere/deleteWhere
operations, and never accepts raw SQL. Resources can explicitly restrict
their operations to read, create, update, and delete.

Anonymous tenant reads require both publicTenantId on createWorker and a
resource-level publicRead declaration. Use publicRead true only when the
whole resource is public; for opt-in rows use a publicRead column/value
declaration such as visibility=public. Anonymous reads never grant anonymous
system access.

Applications may pass subscriptionManifest to createWorker to register their
own subscription IDs and entitlement values. Base exposes
requireSubscription and requireEntitlement but does not know any
product-specific subscription such as VIP. Authenticated users can inspect
their validated active tenant at GET /api/tenant.

Administrators can start a short-lived, HttpOnly impersonation session with
POST /api/admin/users/:id/impersonate and clear it with
POST /api/admin/impersonate/clear. Impersonation affects scoped data context
only and does not grant the target user administrator permissions.

For example, a tenant-owned resource registers its `tenant_id` column with
base, while feature code calls `state.data.tenant.list("recipes")` without
passing a tenant ID. The active tenant must be a validated membership. A
resource used with the wrong scope returns no rows; writes fail closed.

Applications using scoped data must stop passing unrestricted `env.DB` to
domain features. Their migrations still add and backfill ownership columns,
and their resources must be registered with base.
