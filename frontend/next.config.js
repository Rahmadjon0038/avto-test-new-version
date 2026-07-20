/** @type {import('next').NextConfig} */
const path = require("path");

const backendUrl =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "https://api.topshirdi.uz";

const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: path.resolve(__dirname, "..")
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`
      },
      {
        source: "/health",
        destination: `${backendUrl}/health`
      },
      {
        source: "/openapi.json",
        destination: `${backendUrl}/openapi.json`
      },
      {
        source: "/docs/:path*",
        destination: `${backendUrl}/docs/:path*`
      },
      {
        source: "/img",
        destination: `${backendUrl}/img`
      }
    ];
  }
};

module.exports = nextConfig;
