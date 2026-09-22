import type { NextConfig } from "next";

const securityHeaders = [
  // The board mutates state on an authenticated session, so refuse framing
  // entirely rather than relying on the delete confirm() dialogs.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }
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
