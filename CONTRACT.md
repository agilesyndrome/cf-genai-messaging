# Messaging contract

- `conversation({ context, createdBy, participants })` returns a validated,
  serializable conversation model. Context is an opaque, required string.
- `message({ context, sender, body, audience, metadata })` returns a
  validated message model. Message context may be omitted only when a store
  supplies the conversation context.
- `groupMessage(input)` returns a message with `isGroup: true`; group
  participants are represented by the conversation participant list and the
  message audience.
- migrations/0001_messaging.sql is the base D1 schema for the store.
- `createMessagingStore(db, options)` uses a Cloudflare D1-compatible
  `prepare/bind/first/all/run` binding. The optional `prefix` changes the
  table prefix while keeping the same three-table layout.
- `getOrCreateConversation` is idempotent by context.
- `appendMessage` updates the conversation timestamp and preserves arbitrary
  message context, response type, audience, and metadata.
- `executeReplyJob` executes an already-dispatched base job, loads the thread,
  invokes an application-supplied generator, persists its reply, and stores a
  compact `{ conversationId, messageId }` job result.
- The package does not call an AI provider, infer application context, or
  decide who should speak. Host applications own prompts, authorization, and
  response persistence.
- No request-scoped state is stored at module scope.
