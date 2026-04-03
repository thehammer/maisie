import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

const domain = process.env.DOMAIN || "";
const certDir = process.env.CERTS_DIR ||
  (domain ? path.join(process.env.HOME || "", `certs/config/live/${domain}`) : "");
const hasLocalCert = fs.existsSync(path.join(certDir, "fullchain.pem"));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: "0.0.0.0",
    allowedHosts: true,
    ...(hasLocalCert && {
      https: {
        cert: fs.readFileSync(path.join(certDir, "fullchain.pem")),
        key: fs.readFileSync(path.join(certDir, "privkey.pem")),
      },
    }),
    proxy: {
      "/api": "http://localhost:3001",
      "/go2rtc": {
        target: "http://localhost:1984",
        rewrite: (path) => path.replace(/^\/go2rtc/, ""),
        ws: true,
      },
    },
  },
});
