const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const MESSAGING_TABLES = Object.freeze({
  conversations: "messaging_conversations",
  participants: "messaging_conversation_participants",
  messages: "messaging_messages",
});

function text(value, field, { required = false, max = 2048 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new TypeError(field + " is required");
    return null;
  }
  const result = String(value).trim();
  if (required && !result) throw new TypeError(field + " is required");
  if (result.length > max) throw new RangeError(field + " is too long");
  return result || null;
}

function object(value, field) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(field + " must be an object");
  return { ...value };
}

export function normalizeContext(value) {
  return text(value, "context", { required: true, max: 4096 });
}

export function participant(input = {}) {
  const source = typeof input === "string" ? { key: input, name: input } : input;
  const type = text(source.type || source.participantType, "participant.type", { required: true, max: 80 });
  const key = text(source.key || source.id || source.participantKey, "participant.key", { required: true, max: 256 });
  const name = text(source.name || source.displayName || key, "participant.name", { required: true, max: 256 });
  return { type, key, name, metadata: object(source.metadata, "participant.metadata") };
}

export function participants(values = []) {
  if (!Array.isArray(values)) throw new TypeError("participants must be an array");
  const seen = new Set();
  return values.map(participant).filter((value) => {
    const key = value.type + ":" + value.key;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function conversation(input = {}) {
  const source = input || {};
  return {
    id: source.id ?? null,
    context: normalizeContext(source.context),
    title: text(source.title, "title", { max: 256 }),
    createdBy: source.createdBy ? participant(source.createdBy) : null,
    participants: participants(source.participants || []),
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
  };
}

function normalizedMessage(input = {}, defaultContext = null) {
  const source = input || {};
  const sender = participant(source.sender || {
    type: source.senderType,
    key: source.senderKey,
    name: source.senderName,
  });
  const context = source.context === undefined || source.context === null
    ? (defaultContext === null ? null : normalizeContext(defaultContext))
    : normalizeContext(source.context);
  const body = text(source.body, "body", { required: true, max: 16000 });
  const audience = participants(source.audience || source.recipients || []);
  return {
    id: source.id ?? null,
    conversationId: source.conversationId ?? null,
    context,
    sender,
    body,
    messageType: text(source.messageType || source.kind || "text", "messageType", { required: true, max: 80 }),
    responseType: text(source.responseType, "responseType", { max: 80 }),
    audience,
    metadata: object(source.metadata, "metadata"),
    createdAt: source.createdAt || null,
  };
}

export function message(input = {}) {
  return normalizedMessage(input);
}

export function groupMessage(input = {}) {
  const value = normalizedMessage({ ...input, messageType: input.messageType || input.kind || "group" });
  return { ...value, isGroup: true };
}

function identifier(value, field) {
  const result = String(value);
  if (!IDENTIFIER.test(result)) throw new TypeError(field + " must be a safe SQL identifier");
  return result;
}

function json(value, fallback) {
  try { return JSON.parse(value || ""); } catch { return fallback; }
}

function rowParticipant(row) {
  return participant({
    type: row.participant_type,
    key: row.participant_key,
    name: row.display_name,
    metadata: json(row.metadata_json, {}),
  });
}

function rowMessage(row) {
  const value = message({
    id: row.id,
    conversationId: row.conversation_id,
    context: row.context,
    sender: { type: row.sender_type, key: row.sender_key || row.sender_name, name: row.sender_name },
    body: row.body,
    messageType: row.message_type,
    responseType: row.response_type,
    audience: json(row.audience_json, []),
    metadata: json(row.metadata_json, {}),
    createdAt: row.created_at,
  });
  return { ...value, isGroup: value.messageType === "group" || value.audience.length > 0 };
}

export function createMessagingStore(db, options = {}) {
  if (!db || typeof db.prepare !== "function") throw new TypeError("A D1 database binding is required");
  const prefix = identifier(options.prefix || "messaging", "prefix");
  const tables = {
    conversations: prefix + "_conversations",
    participants: prefix + "_conversation_participants",
    messages: prefix + "_messages",
  };

  async function participantsFor(conversationId) {
    const result = await db.prepare("SELECT participant_type,participant_key,display_name,metadata_json FROM " + tables.participants + " WHERE conversation_id=? ORDER BY id").bind(conversationId).all();
    return (result.results || []).map(rowParticipant);
  }

  async function messagesFor(conversationId, options = {}) {
    const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));
    const result = await db.prepare("SELECT id,conversation_id,context,sender_type,sender_key,sender_name,body,message_type,response_type,audience_json,metadata_json,created_at FROM " + tables.messages + " WHERE conversation_id=? ORDER BY id DESC LIMIT ?").bind(conversationId, limit).all();
    return (result.results || []).reverse().map(rowMessage);
  }

  async function hydrate(row, options = {}) {
    if (!row) return null;
    const value = conversation({
      id: row.id,
      context: row.context,
      title: row.title,
      createdBy: row.created_by_key ? { type: row.created_by_type, key: row.created_by_key, name: row.created_by_name || row.created_by_key } : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      participants: [],
    });
    value.participants = await participantsFor(row.id);
    if (options.includeMessages !== false) value.messages = await messagesFor(row.id, options);
    return value;
  }

  async function findConversation(context, options = {}) {
    const value = normalizeContext(context);
    const row = await db.prepare("SELECT * FROM " + tables.conversations + " WHERE context=?").bind(value).first();
    return hydrate(row, options);
  }

  async function findConversationById(id, options = {}) {
    const row = await db.prepare("SELECT * FROM " + tables.conversations + " WHERE id=?").bind(id).first();
    return hydrate(row, options);
  }

  async function addParticipants(conversationId, values) {
    for (const item of participants(values)) {
      await db.prepare("INSERT OR IGNORE INTO " + tables.participants + " (conversation_id,participant_type,participant_key,display_name,metadata_json) VALUES (?,?,?,?,?)").bind(conversationId, item.type, item.key, item.name, JSON.stringify(item.metadata)).run();
    }
  }

  async function createConversation(input) {
    const value = conversation(input);
    const createdBy = value.createdBy;
    const row = await db.prepare("INSERT INTO " + tables.conversations + " (context,title,created_by_type,created_by_key,created_by_name) VALUES (?,?,?,?,?) RETURNING *").bind(value.context, value.title, createdBy?.type || null, createdBy?.key || null, createdBy?.name || null).first();
    await addParticipants(row.id, value.participants);
    return hydrate(row, { includeMessages: false });
  }

  async function getOrCreateConversation(input) {
    const existing = await findConversation(input.context, { includeMessages: false });
    if (existing) {
      await addParticipants(existing.id, input.participants || []);
      return findConversationById(existing.id, { includeMessages: false });
    }
    try {
      return await createConversation(input);
    } catch (error) {
      const raced = await findConversation(input.context, { includeMessages: false });
      if (raced) return raced;
      throw error;
    }
  }

  async function appendMessage(conversationId, input) {
    const thread = await findConversationById(conversationId, { includeMessages: false });
    if (!thread) throw new Error("conversation_not_found");
    const value = normalizedMessage(input, thread.context);
    const row = await db.prepare("INSERT INTO " + tables.messages + " (conversation_id,context,sender_type,sender_key,sender_name,body,message_type,response_type,audience_json,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id,conversation_id,context,sender_type,sender_key,sender_name,body,message_type,response_type,audience_json,metadata_json,created_at").bind(conversationId, value.context, value.sender.type, value.sender.key, value.sender.name, value.body, value.messageType, value.responseType, JSON.stringify(value.audience), JSON.stringify(value.metadata)).first();
    await db.prepare("UPDATE " + tables.conversations + " SET updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(conversationId).run();
    return rowMessage(row);
  }

  return Object.freeze({
    tables,
    findConversation,
    findConversationById,
    createConversation,
    getOrCreateConversation,
    addParticipants,
    getMessages: messagesFor,
    appendMessage,
  });
}

export function createFeature(options = {}) {
  const name = options.name || "cf-genai-messaging";
  return {
    name,
    middleware: async (request, env, ctx, next, state) => {
      if (options.boot) await options.boot(env, { request, ctx, state });
      return options.handle ? options.handle(request, env, ctx, next, state) : next();
    },
  };
}

export const createMessagingFeature = createFeature;
