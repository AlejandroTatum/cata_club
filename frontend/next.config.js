/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output — required for the Docker runtime image (see Dockerfile).
  output: "standalone",
  /* Image configuration — allows local public/ assets */
  images: {
    // unoptimized: true, // uncomment if deploying to a host without image optimization
  },
  // Privacy (VIII), health-data consent (X) and image permission (XI) are
  // chapters of the single terms document (#1615), not pages of their own;
  // old links keep working and land on the chapter.
  async redirects() {
    return [
      { source: "/privacidad", destination: "/terminos#privacidad", permanent: true },
      { source: "/consentimiento-salud", destination: "/terminos#consentimiento-salud", permanent: true },
      { source: "/permiso-imagen-fetm", destination: "/terminos#permiso-imagen", permanent: true },
    ];
  },
};

module.exports = nextConfig;
