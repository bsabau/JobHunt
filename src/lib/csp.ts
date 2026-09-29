// The Content-Security-Policy for pages. No runtime imports, so the tests can
// load it straight from Node.
//
// Scripts: Next reads the nonce from this header while rendering and puts it on
// its own scripts; 'strict-dynamic' then trusts the scripts those load (Vercel
// Analytics). Styles: Radix and Recharts set inline style attributes, which a
// nonce cannot cover, so styles keep 'unsafe-inline'. Images: company logos
// come from the two hosts logo.ts allows, and Google's favicon service
// redirects to tN.gstatic.com, which the policy checks as well.
export function contentSecurityPolicy(nonce: string, options: { development: boolean }): string {
  return [
    "default-src 'self'",
    // React's development build needs eval for its debugging stacks.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://www.google.com https://*.gstatic.com https://logo.clearbit.com",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
}

// Report-only while the policy is new: violations appear in the browser
// console and nothing is blocked. Switch to Content-Security-Policy once a
// production build shows none.
export const CSP_HEADER = "Content-Security-Policy-Report-Only";

// Request header Next reads the nonce from while rendering. It is checked
// before the report-only name, so the proxy always overwrites it.
export const CSP_REQUEST_HEADER = "Content-Security-Policy";

// Request header that hands the nonce to the root layout.
export const NONCE_HEADER = "x-nonce";
