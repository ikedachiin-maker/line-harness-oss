import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// React + Tailwind は salon-booking ページ (?page=salon-book) でのみ使う。
// main.ts から動的 import するので React チャンクは別ファイルに分離され、
// 既存の form / Google Calendar booking 利用者には load されない。
export default defineConfig({
  plugins: [cloudflare(), react(), tailwindcss()],
});
