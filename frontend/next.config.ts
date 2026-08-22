import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
