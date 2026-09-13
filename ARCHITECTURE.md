# Architecture

This package separates a reusable messaging domain from application behavior.

## Domain layer

`conversation`, `message`, `groupMessage`, and participant helpers validate
small serializable objects. Context remains an opaque application string so the
same core can back recipe reviews, game campaigns, life-dashboard journals, or
user-to-user messaging.

## Persistence layer

`createMessagingStore(db)` adapts the domain to D1. It owns:

- one context-keyed conversation;
- a participant roster for group threads;
- messages with independent context, sender, message type, response type,
  audience, and JSON metadata;
- recent-message retrieval ordered oldest-to-newest for prompt construction.

The store is intentionally not an AI client. The host decides how much
conversation history and application data to send to a model, then stores the
model's result as a normal message.

## Integration boundary

The consuming application supplies:

- the package base migration for the three messaging tables, plus any
  application-owned backfill migration;
- authorization and participant identity;
- routes and UI;
- any AI prompt, response contract, or domain-specific metadata.

`createFeature` is retained for the shared Cloudflare feature composition
contract, but messaging persistence can be used directly from a route handler.
