import assert from "node:assert/strict";
import { test } from "node:test";
import { contentSecurityPolicy } from "../src/lib/csp.ts";

const directives = (policy) => Object.fromEntries(policy.split("; ").map((part) => [part.split(" ")[0], part.split(" ").slice(1)]));

test("scripts run only with the request's nonce, and eval only in development", () => {
  const production = directives(contentSecurityPolicy("abc", { development: false }));
  assert.deepEqual(production["script-src"], ["'self'", "'nonce-abc'", "'strict-dynamic'"]);
  assert.ok(directives(contentSecurityPolicy("abc", { development: true }))["script-src"].includes("'unsafe-eval'"));
});

test("framing, plugins and foreign form targets are refused", () => {
  const policy = directives(contentSecurityPolicy("abc", { development: false }));
  assert.deepEqual(policy["frame-ancestors"], ["'none'"]);
  assert.deepEqual(policy["object-src"], ["'none'"]);
  assert.deepEqual(policy["form-action"], ["'self'"]);
});
