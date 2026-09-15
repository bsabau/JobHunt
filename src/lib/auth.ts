const SESSION_COOKIE = "session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type Role = "user" | "guest";

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

export function isAuthConfigurationError(error: unknown): error is AuthConfigurationError {
  return error instanceof AuthConfigurationError;
}

function requireEnv(name: "AUTH_USER" | "AUTH_PASS" | "AUTH_SECRET" | "AUTH_GUEST_PASS"): string {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new AuthConfigurationError(`${name} environment variable is required`);
  }

  return value;
}

function getSecret(): string {
  return requireEnv("AUTH_SECRET");
}

async function hmac(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// A hash of the configured credentials is embedded in the token so that
// rotating AUTH_USER/AUTH_PASS invalidates every previously issued session.
async function credentialVersion(): Promise<string> {
  const encoder = new TextEncoder();
  const material = `${process.env.AUTH_USER ?? ""}:${process.env.AUTH_PASS ?? ""}`;
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(material));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isRole(value: string): value is Role {
  return value === "user" || value === "guest";
}

export async function createSessionToken(role: Role = "user"): Promise<string> {
  const expires = Date.now() + SESSION_MAX_AGE * 1000;
  const version = await credentialVersion();
  const payload = `${role}:${expires}:${version}`;
  const sig = await hmac(payload);
  return `${payload}:${sig}`;
}

export async function verifySessionToken(token: string): Promise<{ valid: boolean; role: Role }> {
  const parts = token.split(":");
  if (parts.length !== 4) return { valid: false, role: "user" };

  const [roleOrLabel, expiresStr, version, sig] = parts;
  if (!isRole(roleOrLabel)) return { valid: false, role: "user" };

  const payload = `${roleOrLabel}:${expiresStr}:${version}`;
  const expectedSig = await hmac(payload);

  if (sig !== expectedSig) return { valid: false, role: "user" };

  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || Date.now() > expires) return { valid: false, role: "user" };

  if (version !== (await credentialVersion())) return { valid: false, role: "user" };

  return { valid: true, role: roleOrLabel };
}

export async function safeVerifySessionToken(token: string): Promise<{ valid: boolean; role: Role }> {
  try {
    return await verifySessionToken(token);
  } catch (error) {
    if (isAuthConfigurationError(error)) {
      console.error(error.message);
      return { valid: false, role: "user" };
    }

    throw error;
  }
}

export function validateCredentials(user: string, pass: string): Role | null {
  if (process.env.AUTH_GUEST_ENABLED === "true" && user === "guest") {
    const guestPass = requireEnv("AUTH_GUEST_PASS");
    if (pass === guestPass) return "guest";
    return null;
  }

  const configuredUser = requireEnv("AUTH_USER");
  const configuredPass = requireEnv("AUTH_PASS");

  if (user === configuredUser && pass === configuredPass) return "user";
  return null;
}

export { SESSION_COOKIE, SESSION_MAX_AGE };
