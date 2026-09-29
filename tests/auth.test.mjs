import assert from "node:assert/strict";
import { createSessionToken, validateCredentials, verifySessionToken } from "../src/lib/auth.ts";

const originalAuthUser = process.env.AUTH_USER;
const originalAuthPass = process.env.AUTH_PASS;
const originalAuthSecret = process.env.AUTH_SECRET;
const originalGuestEnabled = process.env.AUTH_GUEST_ENABLED;
const originalGuestPass = process.env.AUTH_GUEST_PASS;

const invalid = { valid: false, role: "user" };

function restoreEnv() {
  setEnv("AUTH_USER", originalAuthUser);
  setEnv("AUTH_PASS", originalAuthPass);
  setEnv("AUTH_SECRET", originalAuthSecret);
  setEnv("AUTH_GUEST_ENABLED", originalGuestEnabled);
  setEnv("AUTH_GUEST_PASS", originalGuestPass);
}

function setEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

try {
  setEnv("AUTH_USER", "owner");
  setEnv("AUTH_PASS", "password");
  setEnv("AUTH_SECRET", undefined);

  await assert.rejects(() => createSessionToken("user"), /AUTH_SECRET/);

  // A secret shorter than 32 characters is a configuration error, not a key.
  setEnv("AUTH_SECRET", "too-short-secret");
  await assert.rejects(() => createSessionToken("user"), /AUTH_SECRET must be at least 32 characters/);

  setEnv("AUTH_SECRET", "test-session-secret-with-at-least-32-characters");
  setEnv("AUTH_USER", "");
  await assert.rejects(() => validateCredentials("owner", "password"), /AUTH_USER/);

  setEnv("AUTH_USER", "owner");
  setEnv("AUTH_PASS", "");
  await assert.rejects(() => validateCredentials("owner", "password"), /AUTH_PASS/);

  setEnv("AUTH_PASS", "password");
  setEnv("AUTH_GUEST_ENABLED", undefined);
  setEnv("AUTH_GUEST_PASS", undefined);
  assert.equal(await validateCredentials("guest", "guest"), null);
  setEnv("AUTH_GUEST_ENABLED", "true");
  setEnv("AUTH_GUEST_PASS", "guest-pass");
  assert.equal(await validateCredentials("owner", "password"), "user");
  assert.equal(await validateCredentials("guest", "guest"), null);
  assert.equal(await validateCredentials("guest", "guest-pass"), "guest");
  assert.equal(await validateCredentials("owner", "wrong"), null);

  // SPEC-4: a guest token starts valid while guest access is enabled.
  const guestToken = await createSessionToken("guest");
  assert.deepEqual(await verifySessionToken(guestToken), { valid: true, role: "guest" });

  // Rotating AUTH_GUEST_PASS changes the guest credential version, so an
  // already-issued guest token is rejected.
  setEnv("AUTH_GUEST_PASS", "rotated-guest-pass");
  assert.deepEqual(await verifySessionToken(guestToken), invalid);

  // Restoring the old password revives the same token (version matches again)...
  setEnv("AUTH_GUEST_PASS", "guest-pass");
  assert.deepEqual(await verifySessionToken(guestToken), { valid: true, role: "guest" });

  // ...but flipping AUTH_GUEST_ENABLED to false rejects it outright, even
  // though the guest password (and therefore the version) is unchanged.
  setEnv("AUTH_GUEST_ENABLED", "false");
  assert.deepEqual(await verifySessionToken(guestToken), invalid);
  setEnv("AUTH_GUEST_ENABLED", "true");

  // A user token's version still tracks AUTH_USER/AUTH_PASS.
  const userToken = await createSessionToken("user");
  assert.deepEqual(await verifySessionToken(userToken), { valid: true, role: "user" });
  setEnv("AUTH_PASS", "rotated-password");
  assert.deepEqual(await verifySessionToken(userToken), invalid);
  setEnv("AUTH_PASS", "password");

  // Existing tamper case still fails.
  assert.deepEqual(await verifySessionToken(`${guestToken}-tampered`), invalid);

  // Existing expiry case still fails: move the clock past the 7-day window.
  const realDateNow = Date.now;
  Date.now = () => realDateNow() + 8 * 24 * 60 * 60 * 1000;
  try {
    assert.deepEqual(await verifySessionToken(guestToken), invalid);
  } finally {
    Date.now = realDateNow;
  }
} finally {
  restoreEnv();
}
