import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Listen on all interfaces (0.0.0.0), not just localhost, so the dev server
    // is reachable from another device on the same network, e.g. a phone at
    // http://<this-machine's-LAN-IP>:5173.
    host: true,
  },
});
