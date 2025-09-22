import express from "express";
import cors from "cors";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteerExtra.use(StealthPlugin());

const app = express();
app.use(cors());

app.get("/", (req, res) => res.send("Google Play Version API ✅"));

app.get("/version", async (req, res) => {
  const pkg = (req.query.package || "").trim();
  if (!pkg) return res.status(400).json({ error: "Falta ?package=" });

  let browser;
  try {
    browser = await puppeteerExtra.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.goto(
      `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&hl=es&gl=US`,
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );

    // 1) Intento: leer JSON-LD
    let version = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const s of scripts) {
        try {
          const parsed = JSON.parse(s.textContent || "{}");
          if (parsed["@type"] === "SoftwareApplication" && parsed.softwareVersion) {
            return parsed.softwareVersion;
          }
        } catch (e) {}
      }
      return null;
    });

    // 2) Si no está en JSON-LD, abrir modal "Información de la aplicación"
    if (!version) {
      // Clic en el botón usando document.evaluate en vez de page.$x
      await page.evaluate(() => {
        const xpath = "//*[contains(text(),'Información de la aplicación')]";
        const el = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (el) (el as HTMLElement).click();
      });

      await page.waitForSelector('div[role="dialog"]', { timeout: 15000 });

      version = await page.evaluate(() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return null;

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

        if (versionText) return versionText;

        const m = (dialog.textContent || "").match(/\b\d+(?:\.\d+){1,3}\b/);
        return m ? m[0] : null;
      });
    }

    res.json({ package: pkg, version: version || "N/A" });
  } catch (e) {
    res.status(500).json({ package: pkg, error: e.message });
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor escuchando en puerto ${PORT}`));
