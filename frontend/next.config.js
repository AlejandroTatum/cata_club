/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output — required for the Docker runtime image (see Dockerfile).
  output: "standalone",
  /* Image configuration — allows local public/ assets */
  images: {
    // unoptimized: true, // uncomment if deploying to a host without image optimization
  },
  /**
   * Routes that were renamed and still have to answer at their old name.
   *
   * A URL is interface: it is read in the address bar, shared in a message and
   * kept in a bookmark. Retiring one silently breaks links that are already out
   * there, so a rename adds a line here rather than deleting a route.
   *
   * `permanent: true` is a 308 — the move is not coming back, and that is what
   * tells browsers and crawlers to stop asking for the old name.
   *
   * Covered by `src/lib/__tests__/route-redirects.test.ts`, which also fails if
   * a destination here stops existing under `src/app`.
   */
  async redirects() {
    return [
      {
        // The competitive feature was removed and the concept renamed to
        // "nivel"; the sweep reached the labels but not the route. The
        // trainer's `/trainer/nivel` was born with the right name, which is
        // what gave the mismatch away.
        source: "/ranking",
        destination: "/nivel",
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
