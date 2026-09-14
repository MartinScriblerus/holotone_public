import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        embed: "embed.html",
        projection: "projection.html",
      },
    },
  },
  server: {
    port: 5174,
  },
});
