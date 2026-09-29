import assert from "node:assert/strict";
import { test } from "node:test";
import { CSP_HEADER, CSP_REQUEST_HEADER, contentSecurityPolicy } from "../src/lib/csp.ts";
import { ALLOWED_LOGO_HOSTS } from "../src/lib/logo.ts";

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

test("every logo host the lookup may store is allowed as an image source", () => {
  const images = directives(contentSecurityPolicy("abc", { development: false }))["img-src"];
  for (const host of ALLOWED_LOGO_HOSTS) {
    assert.ok(images.includes(`https://${host}`), `${host} is missing from img-src`);
  }
});

// Vercel applies these headers to the incoming request too, where a CSP would
// replace the one the proxy hands Next and strip the nonce from its scripts.
test("next.config.ts sets no Content-Security-Policy header", async () => {
  const { default: config } = await import("../next.config.ts");
  for (const rule of await config.headers()) {
    for (const header of rule.headers) {
      assert.doesNotMatch(header.key, /^content-security-policy/i, `${rule.source} sets ${header.key}`);
    }
    assert.ok(rule.headers.some((header) => header.key === "X-Frame-Options"), "framing must stay refused");
  }
});

// Downgrading to report-only would leave every page working and the tests
// green, so make it a deliberate act.
test("the policy is enforced, and Next reads the nonce from the enforcing request header", () => {
  assert.equal(CSP_HEADER, "Content-Security-Policy");
  assert.equal(CSP_REQUEST_HEADER, "Content-Security-Policy");
});
