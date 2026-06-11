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

function requireEnv(name: "AUTH_USER" | "AUTH_PASS" | "AUTH_SECRET"): string {
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

export async function createSessionToken(role: Role = "user"): Promise<string> {
  const expires = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = `${role}:${expires}`;
  const sig = await hmac(payload);
  return `${payload}:${sig}`;
}

export async function verifySessionToken(token: string): Promise<{ valid: boolean; role: Role }> {
  const parts = token.split(":");
  if (parts.length !== 3) return { valid: false, role: "user" };

  const [roleOrLabel, expiresStr, sig] = parts;
  const payload = `${roleOrLabel}:${expiresStr}`;
  const expectedSig = await hmac(payload);

  if (sig !== expectedSig) return { valid: false, role: "user" };
  if (Date.now() > Number(expiresStr)) return { valid: false, role: "user" };

  const role: Role = roleOrLabel === "guest" ? "guest" : "user";
  return { valid: true, role };
}

export function validateCredentials(user: string, pass: string): Role | null {
  if (user === "guest" && pass === "guest") return "guest";

  const configuredUser = requireEnv("AUTH_USER");
  const configuredPass = requireEnv("AUTH_PASS");

  if (user === configuredUser && pass === configuredPass) return "user";
  return null;
}

export { SESSION_COOKIE, SESSION_MAX_AGE };
