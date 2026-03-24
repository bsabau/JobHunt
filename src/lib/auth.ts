const SESSION_COOKIE = "session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

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

export async function createSessionToken(): Promise<string> {
  const expires = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = `authenticated:${expires}`;
  const sig = await hmac(payload);
  return `${payload}:${sig}`;
}

export async function verifySessionToken(token: string): Promise<boolean> {
  const parts = token.split(":");
  if (parts.length !== 3) return false;

  const [label, expiresStr, sig] = parts;
  const payload = `${label}:${expiresStr}`;
  const expectedSig = await hmac(payload);

  if (sig !== expectedSig) return false;
  if (Date.now() > Number(expiresStr)) return false;

  return true;
}

export function validateCredentials(user: string, pass: string): boolean {
  return user === process.env.AUTH_USER && pass === process.env.AUTH_PASS;
}

export { SESSION_COOKIE, SESSION_MAX_AGE };
