import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Logos are rendered with a regular <img>; keep Next's vulnerable image
    // optimizer out of the request path until dependencies are patched.
    unoptimized: true
  }
};

export default nextConfig;
