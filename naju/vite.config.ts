import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import path from "node:path";

function najuStorePlugin(): Plugin {
  const storeDir = path.resolve(__dirname, "patients");
  const storeFile = path.join(storeDir, "store.json");
  const assetsDir = path.join(storeDir, "assets");
  const defaultStore = { patients: [], files: [], appointments: [], nextFileId: 1, nextAppointmentId: 1 };

  async function ensureDir() {
    await fs.mkdir(storeDir, { recursive: true });
  }

  async function ensureAssetsDir() {
    await fs.mkdir(assetsDir, { recursive: true });
  }

  function safeRelPath(input: string) {
    const rel = input.replace(/^\/+/, "");
    const norm = path.normalize(rel).replace(/^([.]{2}(\/|\\|$))+/, "");
    if (!norm || norm.includes("..") || path.isAbsolute(norm)) return null;
    return norm;
  }

  function safeId(input: string) {
    return (input || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "unknown";
  }

  function safeFileName(input: string) {
    const cleaned = (input || "")
      .trim()
      .replace(/[/\\]+/g, "_")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 160);
    return cleaned || `asset-${Date.now()}`;
  }

  function contentTypeByExt(filename: string) {
    const ext = path.extname(filename).toLowerCase();
    if (ext === ".mp3") return "audio/mpeg";
    if (ext === ".wav") return "audio/wav";
    if (ext === ".ogg") return "audio/ogg";
    if (ext === ".m4a") return "audio/mp4";
    if (ext === ".webm") return "audio/webm";
    if (ext === ".json") return "application/json";
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    if (ext === ".pdf") return "application/pdf";
    return "application/octet-stream";
  }

  return {
    name: "naju-store",
    configureServer(server) {
      // Persist store.json in /patients
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

      // Persist binary assets (audio, images, etc.) in /patients/assets/<patientId>/
      server.middlewares.use("/__naju_asset", async (req, res, next) => {
        try {
          await ensureAssetsDir();

          // req.url here is the sub-path after /__naju_asset
          const urlObj = new URL(req.url || "/", "http://localhost");
          const rel = safeRelPath(decodeURIComponent(urlObj.pathname || "/"));

          if (req.method === "GET") {
            if (!rel) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: "Ruta inválida" }));
              return;
            }

            const abs = path.resolve(assetsDir, rel);
            if (!abs.startsWith(path.resolve(assetsDir))) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: "Ruta inválida" }));
              return;
            }

            try {
              const data = await fs.readFile(abs);
              res.statusCode = 200;
              res.setHeader("Content-Type", contentTypeByExt(abs));
              res.setHeader("Cache-Control", "no-store");
              res.end(data);
            } catch {
              res.statusCode = 404;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: "Archivo no encontrado" }));
            }
            return;
          }

          if (req.method === "POST") {
            let body = "";
            let size = 0;

            req.on("data", (chunk) => {
              size += chunk.length;
              // Permite más que el store.json (audios pueden ser pesados). Ajusta si necesitas.
              if (size > 75 * 1024 * 1024) {
                res.statusCode = 413;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: false, error: "Audio demasiado grande" }));
                req.destroy();
                return;
              }
              body += chunk.toString("utf8");
            });

            req.on("end", async () => {
              try {
                const parsed = JSON.parse(body || "{}");
                const patientId = safeId(String(parsed.patientId || ""));
                const filename = safeFileName(String(parsed.filename || ""));
                const dataBase64 = String(parsed.dataBase64 || "");

                if (!patientId || !filename || !dataBase64) {
                  res.statusCode = 400;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify({ ok: false, error: "Payload incompleto" }));
                  return;
                }

                const patientDir = path.join(assetsDir, patientId);
                await fs.mkdir(patientDir, { recursive: true });

                const abs = path.resolve(patientDir, filename);
                if (!abs.startsWith(path.resolve(patientDir))) {
                  res.statusCode = 400;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify({ ok: false, error: "Nombre de archivo inválido" }));
                  return;
                }

                const buf = Buffer.from(dataBase64, "base64");
                await fs.writeFile(abs, buf);

                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: true, path: `/__naju_asset/${patientId}/${filename}` }));
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
