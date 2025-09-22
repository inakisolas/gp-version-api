import express from "express";
import cors from "cors";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());

// Cache sencillo para no pedir siempre al Play Store (12 horas)
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map();

app.get("/", (req, res) => res.send("Google Play Version API ✅"));

app.get("/version", async (req, res) => {
  const pkg = (req.query.package || "").trim();
  if (!pkg) return res.status(400).json({ error: "Falta ?package=" });

  const hit = cache.get(pkg);
  if (hit && Date.now() - hit.time < CACHE_TTL_MS) {
    return res.json({ package: pkg, version: hit.version, source: hit.source, cached: true });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
    });

    const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&hl=es&gl=US`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // 1) Intento rápido: mirar JSON-LD (a veces incluye softwareVersion)
    let result = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const s of scripts) {
        try {
          const parsed = JSON.parse(s.textContent || "{}");
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          for (const obj of arr) {
            if (obj["@type"] === "SoftwareApplication" && obj.softwareVersion) {
              return { version: String(obj.softwareVersion).trim(), source: "ldjson" };
            }
          }
        } catch (e) {}
      }
      return null;
    });

    // 2) Si no aparece en JSON-LD, abrir el modal "Información de la aplicación" y leer "Versión"
    if (!result) {
      // Botón o elemento que abre el modal (en español)
      const btns = await page.$x("//*[contains(text(),'Información de la aplicación')]");
      if (btns.length) {
        await btns[0].click();
        await page.waitForSelector('div[role="dialog"]', { timeout: 15000 });

        result = await page.evaluate(() => {
          const dialog = document.querySelector('div[role="dialog"]');
          if (!dialog) return null;

          // Recorremos nodos buscando la etiqueta "Versión" o "Versión actual"
          const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_ELEMENT, null);
          let lastLabel = "";
          let versionText = "";

          while (walker.nextNode()) {
            const el = walker.currentNode;
            const text = (el.textContent || "").trim();
            if (!text) continue;

            if (/^Versi[oó]n(\s+actual)?$/i.test(text)) {
              lastLabel = "version";
              continue;
            }
            if (lastLabel === "version") {
              versionText = text;
              break;
            }
          }

          if (versionText) return { version: versionText, source: "modal" };

          // Fallback: buscar algo con pinta de x.y o x.y.z en el modal
          const m = (dialog.textContent || "").match(/\b\d+(?:\.\d+){1,3}\b/);
          if (m) return { version: m[0], source: "modal-regex" };

          return null;
        });
      }
    }

    if (!result) throw new Error("No se pudo extraer la versión");

    cache.set(pkg, { time: Date.now(), version: result.version, source: result.source });
    res.json({ package: pkg, version: result.version, source: result.source });
  } catch (e) {
    res.status(500).json({ package: pkg, error: e.message });
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor escuchando en puerto ${PORT}`));
