import assert from "node:assert/strict";
import { createSessionToken, validateCredentials, verifySessionToken } from "../src/lib/auth.ts";

const originalAuthUser = process.env.AUTH_USER;
const originalAuthPass = process.env.AUTH_PASS;
const originalAuthSecret = process.env.AUTH_SECRET;

function restoreEnv() {
  setEnv("AUTH_USER", originalAuthUser);
  setEnv("AUTH_PASS", originalAuthPass);
  setEnv("AUTH_SECRET", originalAuthSecret);
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

  setEnv("AUTH_SECRET", "test-session-secret");
  setEnv("AUTH_USER", "");
  assert.throws(() => validateCredentials("owner", "password"), /AUTH_USER/);

  setEnv("AUTH_USER", "owner");
  setEnv("AUTH_PASS", "");
  assert.throws(() => validateCredentials("owner", "password"), /AUTH_PASS/);

  setEnv("AUTH_PASS", "password");
  assert.equal(validateCredentials("owner", "password"), "user");
  assert.equal(validateCredentials("guest", "guest"), "guest");
  assert.equal(validateCredentials("owner", "wrong"), null);

  const token = await createSessionToken("guest");
  assert.deepEqual(await verifySessionToken(token), { valid: true, role: "guest" });
  assert.deepEqual(await verifySessionToken(`${token}-tampered`), { valid: false, role: "user" });
} finally {
  restoreEnv();
}
