// The Content-Security-Policy for pages. No runtime imports, so the tests can
// load it straight from Node.
//
// Scripts: Next reads the nonce from this header while rendering and puts it on
// its own scripts; 'strict-dynamic' then trusts the scripts those load (Vercel
// Analytics). Styles: Radix and Recharts set inline style attributes, which a
// nonce cannot cover, so styles keep 'unsafe-inline'. Images: company logos
// come from the two hosts logo.ts allows, and Google's favicon service
// redirects to tN.gstatic.com, which the policy checks as well. No
// upgrade-insecure-requests: every source is already 'self' or https, and on
// http://localhost it would rewrite same-origin requests to https and break
// `next start`.
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

// Enforced. On the request it is where Next reads the nonce while rendering
// (the proxy overwrites any the client sent); on the response the browser
// applies it. Before loosening or tightening the policy, check the Vercel
// deployment with the console open: `next start` does not show every problem.
export const CSP_HEADER = "Content-Security-Policy";

// Request header that hands the nonce to the root layout.
export const NONCE_HEADER = "x-nonce";
