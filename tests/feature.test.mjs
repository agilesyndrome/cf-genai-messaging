import test from "node:test";
import assert from "node:assert/strict";
import {
  conversation,
  createFeature,
  createMessagingStore,
  groupMessage,
  message,
} from "../src/index.js";

class FakeD1 {
  constructor() {
    this.conversations = [];
    this.participants = [];
    this.messages = [];
    this.nextConversation = 1;
    this.nextParticipant = 1;
    this.nextMessage = 1;
  }

  prepare(sql) {
    const db = this;
    return {
      bind(...args) {
        return {
          async first() { return db.first(sql, args); },
          async all() { return { results: db.all(sql, args) }; },
          async run() { db.run(sql, args); return { success: true }; },
        };
      },
    };
  }

  first(sql, args) {
    if (sql.includes("SELECT * FROM messaging_conversations WHERE context=?")) {
      return this.conversations.find((row) => row.context === args[0]) || null;
    }
    if (sql.includes("SELECT * FROM messaging_conversations WHERE id=?")) {
      return this.conversations.find((row) => row.id === args[0]) || null;
    }
    if (sql.startsWith("INSERT INTO messaging_conversations")) {
      const [context, title, createdByType, createdByKey, createdByName] = args;
      const row = { id: this.nextConversation++, context, title, created_by_type: createdByType, created_by_key: createdByKey, created_by_name: createdByName, created_at: "now", updated_at: "now" };
      this.conversations.push(row);
      return row;
    }
    if (sql.startsWith("INSERT INTO messaging_messages")) {
      const [conversationId, context, senderType, senderKey, senderName, body, messageType, responseType, audienceJson, metadataJson] = args;
      const row = { id: this.nextMessage++, conversation_id: conversationId, context, sender_type: senderType, sender_key: senderKey, sender_name: senderName, body, message_type: messageType, response_type: responseType, audience_json: audienceJson, metadata_json: metadataJson, created_at: "now" };
      this.messages.push(row);
      return row;
    }
    return null;
  }

  all(sql, args) {
    if (sql.startsWith("SELECT participant_type")) return this.participants.filter((row) => row.conversation_id === args[0]);
    if (sql.startsWith("SELECT id,conversation_id")) return this.messages.filter((row) => row.conversation_id === args[0]).slice(-args[1]).reverse();
    return [];
  }

  run(sql, args) {
    if (sql.startsWith("INSERT OR IGNORE INTO messaging_conversation_participants")) {
      const [conversationId, type, key, name, metadataJson] = args;
      if (!this.participants.some((row) => row.conversation_id === conversationId && row.participant_type === type && row.participant_key === key)) {
        this.participants.push({ id: this.nextParticipant++, conversation_id: conversationId, participant_type: type, participant_key: key, display_name: name, metadata_json: metadataJson });
      }
    }
  }
}

test("domain models support opaque contexts and group audiences", () => {
  const thread = conversation({
    context: "recipe://123",
    participants: [{ type: "reviewer", key: "gordon", name: "Gordon Ramsay" }],
  });
  const note = message({
    context: "recipe://123/ingredient/salt",
    sender: { type: "user", key: "alex", name: "Alex" },
    body: "Add more salt",
  });
  const group = groupMessage({
    context: "recipe://123",
    sender: { type: "reviewer", key: "gordon", name: "Gordon Ramsay" },
    audience: [{ type: "user", key: "alex", name: "Alex" }],
    body: "It already had enough.",
  });

  assert.equal(thread.context, "recipe://123");
  assert.equal(note.context, "recipe://123/ingredient/salt");
  assert.equal(group.isGroup, true);
  assert.equal(group.audience[0].name, "Alex");
  assert.throws(() => conversation({ context: "" }), /context is required/);
});

test("D1 store persists a context-scoped group conversation and messages", async () => {
  const store = createMessagingStore(new FakeD1());
  const thread = await store.getOrCreateConversation({
    context: "recipe://123",
    createdBy: { type: "user", key: "alex", name: "Alex" },
    participants: [
      { type: "user", key: "alex", name: "Alex" },
      { type: "chef", key: "chef", name: "Chef" },
      { type: "reviewer", key: "gordon", name: "Gordon Ramsay" },
    ],
  });
  const saved = await store.appendMessage(thread.id, groupMessage({
    sender: { type: "reviewer", key: "gordon", name: "Gordon Ramsay" },
    body: "Bloody hell, it already had enough salt.",
    audience: [{ type: "user", key: "alex", name: "Alex" }],
    metadata: { source: "re-review" },
  }));
  const loaded = await store.findConversation("recipe://123");

  assert.equal(thread.context, "recipe://123");
  assert.equal(saved.context, "recipe://123");
  assert.equal(saved.sender.name, "Gordon Ramsay");
  assert.equal(saved.metadata.source, "re-review");
  assert.equal(loaded.participants.length, 3);
  assert.equal(loaded.messages.length, 1);
  assert.equal(loaded.messages[0].isGroup, true);
});

test("feature middleware remains composable", async () => {
  const feature = createFeature({ name: "messaging" });
  const response = await feature.middleware(new Request("https://example.test/"), {}, {}, () => Response.json({ ok: true }), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
