/** @type {import('next').NextConfig} */
const backendUrl =
  process.env.BACKEND_URL ||
  (process.env.NODE_ENV === "development" ? "http://127.0.0.1:4000" : "https://api.road-test.uz");

const nextConfig = {
  reactStrictMode: true,
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
