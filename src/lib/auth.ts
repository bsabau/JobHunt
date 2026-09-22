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

// HMAC-SHA256 gains nothing from a key longer than the block size, but a short
// one is guessable; 32 characters is the floor documented in .env.example.
const MIN_SECRET_LENGTH = 32;

function getSecret(): string {
  const secret = requireEnv("AUTH_SECRET");

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new AuthConfigurationError(`AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  return secret;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function importHmacKey(usages: KeyUsage[]): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  );
}

async function hmac(message: string): Promise<string> {
  const key = await importHmacKey(["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(signature);
}

// Constant-time comparison of two Web Crypto SHA-256 digests. Both inputs are
// hashed to a fixed width first, then every byte is scanned, folding mismatches
// into `diff` with bitwise OR. It never exits early, so the comparison time
// does not reveal where the first difference occurs. Sticking to Web Crypto
// (rather than node:crypto's timingSafeEqual) keeps this usable from edge or
// middleware contexts too.
function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);

  for (let i = 0; i < length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }

  return diff === 0;
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [aDigest, bDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b))
  ]);

  return constantTimeEqualBytes(new Uint8Array(aDigest), new Uint8Array(bDigest));
}

// The version embedded in every token is a KEYED HMAC (keyed with AUTH_SECRET),
// not a plain unkeyed digest of the credentials, so a leaked token cannot be
// used to brute-force the owner's password offline without AUTH_SECRET. It is
// also role-aware: a guest version is derived from AUTH_GUEST_ENABLED /
// AUTH_GUEST_PASS (so disabling guest access or rotating the guest password
// invalidates issued guest tokens), while a user version tracks AUTH_USER /
// AUTH_PASS as before.
async function credentialVersion(role: Role): Promise<string> {
  const material =
    role === "guest"
      ? `${process.env.AUTH_GUEST_ENABLED ?? ""}:${process.env.AUTH_GUEST_PASS ?? ""}`
      : `${process.env.AUTH_USER ?? ""}:${process.env.AUTH_PASS ?? ""}`;

  return hmac(`credential-version:${role}:${material}`);
}

function isRole(value: string): value is Role {
  return value === "user" || value === "guest";
}

export async function createSessionToken(role: Role = "user"): Promise<string> {
  const expires = Date.now() + SESSION_MAX_AGE * 1000;
  const version = await credentialVersion(role);
  const payload = `${role}:${expires}:${version}`;
  const sig = await hmac(payload);
  return `${payload}:${sig}`;
}

export async function verifySessionToken(token: string): Promise<{ valid: boolean; role: Role }> {
  const parts = token.split(":");
  if (parts.length !== 4) return { valid: false, role: "user" };

  const [roleOrLabel, expiresStr, version, sig] = parts;
  if (!isRole(roleOrLabel)) return { valid: false, role: "user" };

  // Defense in depth: never honor a guest token while guest access is off, even
  // if the embedded version happens to still match.
  if (roleOrLabel === "guest" && process.env.AUTH_GUEST_ENABLED !== "true") {
    return { valid: false, role: "user" };
  }

  const signatureBytes = fromHex(sig);
  if (!signatureBytes) return { valid: false, role: "user" };

  // crypto.subtle.verify performs a constant-time signature check; comparing
  // recomputed hex strings with !== would leak timing information.
  const key = await importHmacKey(["verify"]);
  const data = new TextEncoder().encode(`${roleOrLabel}:${expiresStr}:${version}`);
  const signatureValid = await crypto.subtle.verify("HMAC", key, signatureBytes, data);
  if (!signatureValid) return { valid: false, role: "user" };

  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || Date.now() > expires) return { valid: false, role: "user" };

  if (version !== (await credentialVersion(roleOrLabel))) return { valid: false, role: "user" };

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

export interface Session {
  role: Role;
}

// Second line of defense behind the proxy: every route handler and page calls
// this before touching the database. Throws a typed 401 when there is no valid
// session, and a typed 403 when a guest attempts a write.
export async function requireSession(options: { write?: boolean } = {}): Promise<Session> {
  // Imported lazily so this module remains importable outside the Next runtime
  // (e.g. scripts/verify-auth.mjs), which only exercises the pure helpers.
  const [{ cookies }, { ForbiddenError, UnauthorizedError }] = await Promise.all([
    import("next/headers"),
    import("@/lib/api-errors")
  ]);

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await safeVerifySessionToken(token) : null;

  if (!session?.valid) {
    throw new UnauthorizedError("Authentication required");
  }

  if (options.write && session.role === "guest") {
    throw new ForbiddenError("Guest access is read-only");
  }

  return { role: session.role };
}

export async function validateCredentials(user: string, pass: string): Promise<Role | null> {
  if (process.env.AUTH_GUEST_ENABLED === "true" && user === "guest") {
    const guestPass = requireEnv("AUTH_GUEST_PASS");
    if (await constantTimeEqual(pass, guestPass)) return "guest";
    return null;
  }

  const configuredUser = requireEnv("AUTH_USER");
  const configuredPass = requireEnv("AUTH_PASS");

  // Both fields are compared with constant-time digests. Evaluating the two
  // promises before combining them keeps the work identical whether the
  // username or the password is the mismatching field.
  const [userMatches, passMatches] = await Promise.all([
    constantTimeEqual(user, configuredUser),
    constantTimeEqual(pass, configuredPass)
  ]);

  if (userMatches && passMatches) return "user";
  return null;
}

export { SESSION_COOKIE, SESSION_MAX_AGE };
