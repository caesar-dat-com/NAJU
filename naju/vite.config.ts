import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import path from "node:path";

function najuStorePlugin(): Plugin {
  const storeDir = path.resolve(__dirname, "patients");
  const storeFile = path.join(storeDir, "store.json");
  const defaultStore = { patients: [], files: [], nextFileId: 1 };

  async function ensureDir() {
    await fs.mkdir(storeDir, { recursive: true });
  }

  return {
    name: "naju-store",
    configureServer(server) {
      server.middlewares.use("/__naju_store", async (req, res, next) => {
        try {
          await ensureDir();

          if (req.method === "GET") {
            try {
              const raw = await fs.readFile(storeFile, "utf8");
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.setHeader("Cache-Control", "no-store");
              res.end(raw);
              return;
            } catch {
              await fs.writeFile(storeFile, JSON.stringify(defaultStore, null, 2), "utf8");
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.setHeader("Cache-Control", "no-store");
              res.end(JSON.stringify(defaultStore));
              return;
            }
          }

          if (req.method === "POST") {
            let body = "";
            let size = 0;

            req.on("data", (chunk) => {
              size += chunk.length;
              if (size > 25 * 1024 * 1024) {
                res.statusCode = 413;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: false, error: "Payload demasiado grande" }));
                req.destroy();
                return;
              }
              body += chunk.toString("utf8");
            });

            req.on("end", async () => {
              try {
                const parsed = JSON.parse(body || "{}");
                await fs.writeFile(storeFile, JSON.stringify(parsed, null, 2), "utf8");
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: true }));
              } catch {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: false, error: "JSON inválido" }));
              }
            });

            return;
          }

          next();
        } catch {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: false, error: "Error interno" }));
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), najuStorePlugin()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
