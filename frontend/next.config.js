/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output — required for the Docker runtime image (see Dockerfile).
  output: "standalone",
  /* Image configuration — allows local public/ assets */
  images: {
    // unoptimized: true, // uncomment if deploying to a host without image optimization
  },
  // The privacy notice is chapter VIII of the terms, not a page of its own;
  // old links to /privacidad keep working.
  async redirects() {
    return [{ source: "/privacidad", destination: "/terminos#privacidad", permanent: true }];
  },
};

module.exports = nextConfig;
