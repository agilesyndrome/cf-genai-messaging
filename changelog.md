# Changelog

## 5.0.0

- Require cf-genai-base 5.
- Add provider-neutral durable reply execution through `executeReplyJob`.
- Persist generated replies through the messaging store and expose only compact conversation/message IDs in job results.
