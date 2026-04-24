// ============================================================
// BXT-SCRAPPER — Main Orchestrator
// Coordinates: CSV → Search → Match → Scrape Price → Output
// ============================================================

import { config } from "./config/index.js";
import { logger } from "./utils/logger.js";
import { readProductsCsv } from "./utils/csv-reader.js";
import {
  getOutputFilePath,
  loadCompletedSkus,
  appendResultRow,
} from "./utils/csv-writer.js";
import { randomDelay } from "./utils/delay.js";
import { BrowserService } from "./services/browser.service.js";
import { AmazonSearchService } from "./services/amazon-search.service.js";
import { JbHifiSearchService } from "./services/jbhifi-search.service.js";
import { PhonebotSearchService } from "./services/phonebot-search.service.js";
import { KoganSearchService } from "./services/kogan-search.service.js";
import { GeminiMatcherService } from "./services/gemini-matcher.service.js";
import type { BecexProduct, ScrapedResult, AmazonSearchResult } from "./types/index.js";
import fs from "fs";
import type { Page } from "playwright";

// ── Graceful Shutdown ──────────────────────────────────────
let isShuttingDown = false;

function setupGracefulShutdown(browserService: BrowserService): void {
  const handleShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.warn(`Received ${signal}. Shutting down gracefully...`);
    await browserService.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
}

// ── Build Result Row Helpers ───────────────────────────────

function buildMatchedResult(
  product: BecexProduct,
  amazonUrl: string,
  amazonTitle: string,
  amazonPrice: number | null,
  confidence: number
): ScrapedResult {
  return {
    sku: product.sku,
    productName: product.productName,
    amazonUrl,
    amazonTitle,
    amazonPrice,
    matchConfidence: confidence,
    status: "matched",
    errorMessage: "",
  };
}

function buildNoMatchResult(product: BecexProduct): ScrapedResult {
  return {
    sku: product.sku,
    productName: product.productName,
    amazonUrl: "",
    amazonTitle: "",
    amazonPrice: null,
    matchConfidence: 0,
    status: "no_match",
    errorMessage: "",
  };
}

function buildErrorResult(product: BecexProduct, errorMessage: string): ScrapedResult {
  return {
    sku: product.sku,
    productName: product.productName,
    amazonUrl: "",
    amazonTitle: "",
    amazonPrice: null,
    matchConfidence: 0,
    status: "error",
    errorMessage,
  };
}

// ── Extraction Helpers ─────────────────────────────────────

async function extractPriceFromProductPage(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    // Try multiple selectors for price on detail page
    const priceSelectors = [
      ".a-price .a-offscreen",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
      ".a-price .a-price-whole",
      '[data-testid="ticket-price"]',
      ".product-price",
      ".price-new",
      '[aria-label^="Price:"]',
      ".price__current",
    ];

    for (const selector of priceSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent || "";
        const match = text.replace(/[^0-9.]/g, "");
        if (match) return parseFloat(match);
      }
    }
    return null;
  });
}

function cleanAmazonUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const dpMatch = url.pathname.match(/\/dp\/([A-Z0-9]{10})/);
    if (dpMatch) {
      return `https://www.amazon.com.au/dp/${dpMatch[1]}`;
    }
    return rawUrl.split("?")[0];
  } catch {
    return rawUrl;
  }
}

// ── Process Single Product ─────────────────────────────────

async function processSingleProduct(
  product: BecexProduct,
  searchService: AmazonSearchService | JbHifiSearchService | KoganSearchService | PhonebotSearchService,
  matcherService: GeminiMatcherService,
  page: Page
): Promise<ScrapedResult> {
  // Step 1: Human-like Search
  const searchQuery = product.productName
    .replace(/\s*-\s*Brand New\s*$/i, "")
    .replace(/[()"]/g, "")
    .trim();

  const searchResults = await searchService.searchProduct(page, searchQuery);

  if (searchResults.length === 0) {
    return buildNoMatchResult(product);
  }

  // Step 2: Take screenshot and use AI matching
  const screenshot = await page.screenshot({ fullPage: false });
  const matchResult = await matcherService.findBestMatch(product, searchResults, screenshot);

  if (!matchResult.isMatch || matchResult.matchedResultIndex < 0) {
    return buildNoMatchResult(product);
  }

  const matchedResult = searchResults[matchResult.matchedResultIndex];
  
  // Step 3: Visit product page
  logger.info(`AI selected result [${matchResult.matchedResultIndex}]. Visiting...`);
  await page.goto(matchedResult.url, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Step 4: Extract Price from detail page
  const price = await extractPriceFromProductPage(page);
  const cleanUrl = config.scraperTarget === "amazon" 
    ? cleanAmazonUrl(matchedResult.url) 
    : matchedResult.url.split("?")[0];

  return buildMatchedResult(
    product,
    cleanUrl,
    matchedResult.title,
    price,
    matchResult.confidence
  );
}

// ── Main Orchestrator ──────────────────────────────────────

async function main(): Promise<void> {
  const startTime = Date.now();

  logger.info("═══════════════════════════════════════════");
  logger.info("  BXT-SCRAPPER — Amazon Price Finder       ");
  logger.info("═══════════════════════════════════════════");

  const products = await readProductsCsv(config.inputCsvPath);
  const outputPath = getOutputFilePath(config.outputDir);
  fs.mkdirSync(config.outputDir, { recursive: true });
  const completedSkus = await loadCompletedSkus(outputPath);

  const pendingProducts = products.filter(p => !completedSkus.has(p.sku)).slice(0, 50);

  if (pendingProducts.length === 0) {
    logger.info("Nothing to do.");
    return;
  }

  const browserService = new BrowserService(config.proxyUrl);
  setupGracefulShutdown(browserService);

  await browserService.initialize();
  const page = await browserService.newPage();

  let searchService;
  if (config.scraperTarget === "jbhifi") {
    searchService = new JbHifiSearchService(config.jbhifiDomain, config.maxSearchResults);
  } else if (config.scraperTarget === "phonebot") {
    searchService = new PhonebotSearchService(config.phonebotDomain, config.maxSearchResults);
  } else if (config.scraperTarget === "kogan") {
    searchService = new KoganSearchService(config.koganDomain, config.maxSearchResults);
  } else {
    searchService = new AmazonSearchService(config.amazonDomain, config.maxSearchResults);
  }
    
  const matcherService = new GeminiMatcherService(config.geminiApiKey);

  for (let i = 0; i < pendingProducts.length; i++) {
    if (isShuttingDown) break;

    const product = pendingProducts[i];
    const progress = `[${i + 1}/${pendingProducts.length}]`;

    logger.info(`${progress} Processing: ${product.productName}`);

    try {
      const result = await processSingleProduct(product, searchService, matcherService, page);
      await appendResultRow(outputPath, result);

      const statusEmoji = result.status === "matched" ? "✅" : "❌";
      const priceLog = result.amazonPrice ? ` — A$${result.amazonPrice}` : "";
      logger.info(`${progress} ${statusEmoji} ${result.status}${priceLog}`);
    } catch (error) {
      const errorMessage = (error as Error).message;
      if (errorMessage === "CAPTCHA_DETECTED") {
        logger.error("CAPTCHA detected! Waiting 60s...");
        await randomDelay(60000, 90000);
        i--; continue;
      }
      logger.error(`${progress} ⚠️ Error: ${errorMessage}`);
    }

    if (i < pendingProducts.length - 1 && !isShuttingDown) {
      await randomDelay(config.requestDelayMinMs, config.requestDelayMaxMs);
    }
  }

  await browserService.shutdown();
  logger.info(`Done! Results: ${outputPath}`);
}

main().catch(err => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
