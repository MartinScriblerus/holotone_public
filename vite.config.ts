import { defineConfig, type Connect, type Plugin } from "vite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/** Dev-only: /projection/:id and /hydra/:id → projection.html (Vercel rewrites don't apply to vite). */
function holotoneDevRewrites(): Plugin {
  const sendHtml = (file: string, res: Connect.ServerResponse, next: Connect.NextFunction) => {
    const abs = path.resolve(rootDir, file);
    if (!fs.existsSync(abs)) {
      next();
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.statusCode = 200;
    res.end(fs.readFileSync(abs));
  };

  return {
    name: "holotone-dev-rewrites",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (/^\/(?:projection|hydra)\/[^/]+\/?$/.test(url)) {
          sendHtml("projection.html", res, next);
          return;
        }
        if (url === "/embed" || url === "/embed/" || /^\/embed\/[^/]+\/?$/.test(url)) {
          sendHtml("embed.html", res, next);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [holotoneDevRewrites()],
  // hydra-synth / raf-loop expect Node's `global` in the browser
  define: {
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["hydra-synth"],
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
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
