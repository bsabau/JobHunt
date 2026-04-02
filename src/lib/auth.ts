const SESSION_COOKIE = "session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type Role = "user" | "guest";

function getSecret(): string {
  return process.env.AUTH_PASS ?? "";
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
  if (user === process.env.AUTH_USER && pass === process.env.AUTH_PASS) return "user";
  return null;
}

export { SESSION_COOKIE, SESSION_MAX_AGE };
