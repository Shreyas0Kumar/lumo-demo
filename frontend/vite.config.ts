import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";

/** Map /summary/<id> and /demo → /demo.html in dev so deep links work. */
function devRewrites(): Plugin {
  return {
    name: "lumo-dev-rewrites",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (!req.url) return next();
        if (req.url === "/demo" || req.url.startsWith("/demo?")) {
          req.url = "/demo.html" + req.url.slice("/demo".length);
        } else if (/^\/summary\/[^/?]+/.test(req.url)) {
          req.url = "/demo.html";
        }
        next();
      });
    },
  };
}

export default defineConfig({
  appType: "mpa",
  plugins: [devRewrites()],
  build: {
    outDir: "dist",
    assetsDir: "assets",
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        demo: resolve(__dirname, "demo.html"),
      },
    },
  },
  server: {
    proxy: {
      "/session": {
        target: "http://localhost:8000",
        changeOrigin: true,
        ws: true,
      },
      "/debug": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
