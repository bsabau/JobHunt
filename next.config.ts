import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "logo.clearbit.com"
      },
      {
        protocol: "https",
        hostname: "images.crunchbase.com"
      }
    ]
  }
};

export default nextConfig;
