import type { NextConfig } from "next";

/* The demo build switch, and the one place that explains how it works.
 *
 * Screens read `process.env.NEXT_PUBLIC_DEMO_MODE === "1"` inline rather than
 * importing a shared constant. That looks like duplication worth refactoring
 * away; it is not. Turbopack folds the comparison into `false` at the use
 * site, and the minifier then drops the branch and every demo-only component
 * it referenced. A constant exported from a shared module stays a runtime
 * property lookup, so the branch survives and the state switchers, the shared
 * password and the platform launcher all ship inside the bundle a real user
 * downloads. Both were measured by grepping .next/static.
 *
 * This copy is separate again because it runs in the Node config process,
 * before any bundler inlining happens. */
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

const nextConfig: NextConfig = {
  /* Publishing the flag here rather than relying on the ambient environment is
     what makes it a compile-time constant. An unset NEXT_PUBLIC_* variable is
     not inlined at all — `process.env.NEXT_PUBLIC_DEMO_MODE` survives into the
     bundle, `DEMO_MODE` stays an unknown, and every `DEMO_MODE && …` branch is
     kept along with the components it references. Declared here it is always
     the literal "0" or "1", the comparison folds, and the demo-only modules
     fall out of the graph. Verified by grepping .next/static, not assumed. */
  env: { NEXT_PUBLIC_DEMO_MODE: DEMO_MODE ? "1" : "0" },

  /* Testing the camera needs a secure context, which means reaching this dev
     server from a phone through an https tunnel or the LAN. The dev server
     blocks /_next/* requests from origins it does not recognise — the page
     HTML still returns 200 while every JS chunk 403s, so the app just comes
     up blank. These entries are dev-only and have no effect on a build. */
  allowedDevOrigins: [
    "*.trycloudflare.com", // cloudflared quick tunnels (new hostname each run)
    "*.ngrok-free.app",
    "*.ngrok.io",
    "192.168.*.*", // same-wifi access over the LAN
    "10.*.*.*",
    "172.16.*.*",
  ],
  /* "/" is the platform launcher, which exists so a reviewer can pick a
     surface. Real users arrive at one or the other and have no use for it, so
     outside a demo build the route redirects before it renders — no flash of a
     page captioned "โหมดสาธิต". */
  async redirects() {
    return DEMO_MODE
      ? []
      : [{ source: "/", destination: "/m/login", permanent: false }];
  },
  async rewrites() {
    return [
      {
        source: "/v1/:path*",
        destination: "http://localhost:8000/v1/:path*",
      },
      {
        source: "/shelfeye-raw/:path*",
        destination: "http://localhost:9000/shelfeye-raw/:path*",
      },
    ];
  },
};

export default nextConfig;
