// ============================================================
// Backmarket Search Service
// Scrapes Backmarket search results and selects variants
// ============================================================

import type { Page } from "playwright";
import type { AmazonSearchResult, BecexProduct } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { randomDelay } from "../utils/delay.js";

export class BackmarketSearchService {
  private readonly domain: string;
  private readonly maxResults: number;

  constructor(domain: string, maxResults: number) {
    this.domain = domain;
    this.maxResults = maxResults;
  }

  async searchProduct(page: Page, productQuery: string): Promise<AmazonSearchResult[]> {
    const searchUrl = `https://${this.domain}/en-au/search?q=${encodeURIComponent(productQuery)}`;
    logger.info(`Visiting Backmarket: ${searchUrl}`);
    
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await randomDelay(2000, 3000);

    const results = await page.evaluate((maxResults) => {
      const items: any[] = [];
      const cards = document.querySelectorAll('a[data-qa="product-thumb"]');
      
      for (const card of Array.from(cards).slice(0, maxResults)) {
        const titleEl = card.querySelector('h2');
        const priceEl = card.querySelector('[data-qa="price"]');
        
        if (!titleEl) continue;

        const title = titleEl.textContent?.trim() || "";
        const rawUrl = card.getAttribute('href') || "";
        const url = rawUrl.startsWith('http') ? rawUrl : `https://${window.location.host}${rawUrl}`;
        
        let price = null;
        if (priceEl) {
          const match = priceEl.textContent?.replace(/[^0-9.]/g, "");
          if (match) price = parseFloat(match);
        }

        items.push({ title, price, url, rating: null, reviewCount: null, isPrime: false });
      }
      return items;
    }, this.maxResults);

    logger.info(`Found ${results.length} results on Backmarket.`);
    return results;
  }

  async selectVariantsAndGetPrice(page: Page, product: BecexProduct): Promise<{price: number | null, cleanUrl: string}> {
    logger.info("Selecting Backmarket variants based on mapping rules...");
    await randomDelay(2000, 3000);

    const isPristine = product.sku.endsWith("-VR-ASN-AU");
    const isExcellent = product.sku.endsWith("-RD-VR-EXD-AU");

    // Click condition
    if (isPristine) {
      await this.clickVariantByText(page, ["Excellent"]);
    } else if (isExcellent) {
      await this.clickVariantByText(page, ["Good"]);
    }

    // Backmarket SIM rules
    await this.clickVariantByText(page, ["Physical SIM", "Dual SIM", "Nano-SIM"]);

    await randomDelay(1000, 2000);

    const price = await page.evaluate(() => {
      const priceSelectors = ['[data-qa="price"]', '.price'];
      for (const sel of priceSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const match = el.textContent?.replace(/[^0-9.]/g, "");
          if (match) return parseFloat(match);
        }
      }
      return null;
    });

    return { price, cleanUrl: page.url().split('?')[0] };
  }

  private async clickVariantByText(page: Page, texts: string[]): Promise<void> {
    try {
      const buttons = await page.$$('button, label, [role="button"]');
      for (const btn of buttons) {
        const text = await btn.textContent();
        if (text && texts.some(t => text.toLowerCase().includes(t.toLowerCase()))) {
          await btn.click().catch(() => {});
          await randomDelay(300, 600);
          return;
        }
      }
    } catch (e) {
      logger.warn(`Could not select variant: ${texts.join(" or ")}`);
    }
  }
}
