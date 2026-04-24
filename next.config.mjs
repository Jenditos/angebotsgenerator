/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingExcludes: {
    "/*": ["next.config.mjs"]
  },
  turbopack: {
    root: process.cwd()
  }
};

export default nextConfig;
