// ============================================================
// BuyMobile Search Service
// Scrapes BuyMobile search results and selects color variants
// ============================================================

import type { Page } from "playwright";
import type { AmazonSearchResult, BecexProduct } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { randomDelay } from "../utils/delay.js";

export class BuymobileSearchService {
  private readonly domain: string;
  private readonly maxResults: number;

  constructor(domain: string, maxResults: number) {
    this.domain = domain;
    this.maxResults = maxResults;
  }

  async searchProduct(page: Page, productQuery: string): Promise<AmazonSearchResult[]> {
    const searchUrl = `https://${this.domain}/search?q=${encodeURIComponent(productQuery)}`;
    logger.info(`Visiting BuyMobile: ${searchUrl}`);
    
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await randomDelay(2000, 3000);

    const results = await page.evaluate((maxResults) => {
      const items: any[] = [];
      const cards = document.querySelectorAll('.product-card, .grid__item, .product-item');
      
      for (const card of Array.from(cards).slice(0, maxResults)) {
        const titleEl = card.querySelector('.product-card__title, .product-title, h3');
        const priceEl = card.querySelector('.price-item--regular, .price, .money');
        const aEl = card.querySelector('a');
        
        if (!titleEl || !aEl) continue;

        const title = titleEl.textContent?.trim() || "";
        const rawUrl = aEl.getAttribute('href') || "";
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

    logger.info(`Found ${results.length} results on BuyMobile.`);
    return results;
  }

  async selectVariantsAndGetPrice(page: Page, product: BecexProduct): Promise<{price: number | null, cleanUrl: string}> {
    logger.info("Selecting BuyMobile color variants...");
    await randomDelay(2000, 3000);

    // Try to extract color from productName
    // e.g. "Samsung Galaxy S24 Ultra 5G (12GB/512GB) - Titanium Black"
    const colorMatch = product.productName.match(/-\s*([a-zA-Z\s]+?)(?:\s*-\s*Brand New)?$/i);
    if (colorMatch && colorMatch[1]) {
      const colorTarget = colorMatch[1].trim();
      logger.info(`Attempting to select color: ${colorTarget}`);
      
      try {
        const labels = await page.$$('label, .swatch, .color-swatch, button');
        for (const label of labels) {
          const text = (await label.textContent()) || "";
          const value = (await label.getAttribute('value')) || "";
          const aria = (await label.getAttribute('aria-label')) || "";
          
          const combined = `${text} ${value} ${aria}`.toLowerCase();
          
          if (combined.includes(colorTarget.toLowerCase())) {
            await label.click().catch(() => {});
            await randomDelay(1000, 2000);
            break;
          }
        }
      } catch (e) {
        logger.warn(`Could not select variant color: ${colorTarget}`);
      }
    }

    const price = await page.evaluate(() => {
      const priceSelectors = ['.price-item--sale', '.price-item--regular', '.product__price', '.price'];
      for (const sel of priceSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const match = el.textContent?.replace(/[^0-9.]/g, "");
          if (match) return parseFloat(match);
        }
      }
      return null;
    });

    return { price, cleanUrl: page.url() }; // Keep the ?variant= in URL for BuyMobile
  }
}
