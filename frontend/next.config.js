/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output — required for the Docker runtime image (see Dockerfile).
  output: "standalone",
  /* Image configuration — allows local public/ assets */
  images: {
    // unoptimized: true, // uncomment if deploying to a host without image optimization
  },
};

module.exports = nextConfig;
