import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    // フロントからの /api/chat をExpressへ転送する。
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
});
