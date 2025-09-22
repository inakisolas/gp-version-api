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
    await page.goto(`https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&hl=es&gl=US`, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // Intento extraer versión desde JSON-LD
    let result = await page.evaluate(() => {
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

    res.json({ package: pkg, version: result || "N/A" });
  } catch (e) {
    res.status(500).json({ package: pkg, error: e.message });
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor escuchando en puerto ${PORT}`));
