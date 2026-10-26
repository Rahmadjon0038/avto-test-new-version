/** @type {import('next').NextConfig} */
const path = require("path");

const backendUrl =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:4001";

const staticAssetHeaders = [
  { key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    root: path.resolve(__dirname, "..")
  },
  // public/ ichidagi o'zgarmas rasmlar (default.png, way.webp...) avval max-age=0 bilan berilib,
  // har safar qayta yuklanardi.
  async headers() {
    return [
      { source: "/default.png", headers: staticAssetHeaders },
      { source: "/way.webp", headers: staticAssetHeaders },
      { source: "/placeholder.svg", headers: staticAssetHeaders }
    ];
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
