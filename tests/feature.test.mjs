import test from "node:test";
import assert from "node:assert/strict";
import { createFeature } from "../src/index.js";

test("feature delegates to the next handler", async () => {
  const feature = createFeature({ name: "example" });
  const response = await feature.middleware(new Request("https://example.test/"), {}, {}, () => Response.json({ ok: true }), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
