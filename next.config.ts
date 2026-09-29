import type { NextConfig } from "next";

const securityHeaders = [
  // The board mutates state on an authenticated session, so refuse framing
  // entirely rather than relying on the delete confirm() dialogs. No
  // Content-Security-Policy here: Vercel also applies these headers to the
  // incoming request, where it would replace the policy the proxy hands Next
  // and leave Next's scripts without the nonce. The page policy
  // (src/lib/csp.ts) carries frame-ancestors 'none'.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
];

const nextConfig: NextConfig = {
  images: {
    // Logos are third-party favicons rendered with a plain <img>, so the image
    // optimizer (and its remote-pattern surface) stays out of the request path.
    unoptimized: true
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders
      }
    ];
  }
};

export default nextConfig;
