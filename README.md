# @agilesyndrome/cf-genai-messaging

A small, provider-neutral messaging core for Cloudflare Workers. It models
persistent conversations, participants, messages, and group messages without
assuming that the subject is a recipe, an AI agent, or even an AI conversation.

A context is an application-owned string. Examples include:

- `recipe://123`
- `gta://campaign/los-santos`
- `life://daily/2026-09-13`

The context is deliberately opaque to this package. Applications can use it to
scope a conversation and can override it on an individual message when a
message refers to a more specific object.

## Public API

`conversation(input)` and `message(input)` return validated, serializable
domain objects. `groupMessage(input)` is the same message shape with explicit
group semantics and an optional audience.

`createMessagingStore(env.DB)` provides a D1-backed repository:

```js
import {
  createMessagingStore,
  groupMessage,
} from "@agilesyndrome/cf-genai-messaging";

const messaging = createMessagingStore(env.DB);
const thread = await messaging.getOrCreateConversation({
  context: "recipe://123",
  createdBy: { type: "user", key: "alex", name: "Alex" },
  participants: [
    { type: "user", key: "alex", name: "Alex" },
    { type: "chef", key: "chef", name: "Chef" },
    { type: "reviewer", key: "gordon", name: "Gordon Ramsay" },
  ],
});

await messaging.appendMessage(thread.id, groupMessage({
  context: "recipe://123",
  sender: { type: "reviewer", key: "gordon", name: "Gordon Ramsay" },
  audience: [{ type: "user", key: "alex", name: "Alex" }],
  body: "Bloody hell, it already had enough salt.",
  metadata: { source: "re-review" },
}));
```

The store owns no AI behavior. A host application can persist a user message,
send the recent thread plus application context to any model, and persist the
model or reviewer response as another message.

## Storage

The package ships migrations/0001_messaging.sql with the additive tables:

- `messaging_conversations`
- `messaging_conversation_participants`
- `messaging_messages`

The schema is intentionally open-ended: participant and sender types are text,
message context is text, and structured metadata/audience are JSON. A host
application applies or vendors that base migration, then may add an
application-owned migration to copy legacy records into these tables.

The default feature factory remains available as `createFeature(options)`
(or `createMessagingFeature(options)`) for applications that compose
middleware through `cf-genai-base`.
