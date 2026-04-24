// ============================================================
// Environment Configuration Loader
// Validates and exports typed config from .env
// ============================================================

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import type { ScraperTarget } from "../types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

interface AppConfig {
  geminiApiKey: string;
  proxyUrl: string | null;
  amazonDomain: string;
  jbhifiDomain: string;
  koganDomain: string;
  phonebotDomain: string;
  scraperTarget: ScraperTarget;
  requestDelayMinMs: number;
  requestDelayMaxMs: number;
  maxSearchResults: number;
  inputCsvPath: string;
  outputDir: string;
  projectRoot: string;
  isDryRun: boolean;
}

function loadConfig(): AppConfig {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey || geminiApiKey === "your_gemini_api_key_here") {
    throw new Error(
      "GEMINI_API_KEY is required. Set it in .env file."
    );
  }

  const isDryRun = process.argv.includes("--dry-run");

  return {
    geminiApiKey,
    proxyUrl: process.env.PROXY_URL || null,
    amazonDomain: process.env.AMAZON_DOMAIN || "amazon.com.au",
    jbhifiDomain: process.env.JBHIFI_DOMAIN || "www.jbhifi.com.au",
    phonebotDomain: process.env.PHONEBOT_DOMAIN || "www.phonebot.com.au",
    koganDomain: process.env.KOGAN_DOMAIN || "www.kogan.com.au",
    scraperTarget: (process.env.SCRAPER_TARGET as any) || "amazon",
    requestDelayMinMs: parseInt(process.env.REQUEST_DELAY_MIN_MS || "3000", 10),
    requestDelayMaxMs: parseInt(process.env.REQUEST_DELAY_MAX_MS || "8000", 10),
    maxSearchResults: parseInt(process.env.MAX_SEARCH_RESULTS || "5", 10),
    inputCsvPath: path.resolve(
      PROJECT_ROOT,
      process.env.INPUT_CSV_PATH || "input/products.csv"
    ),
    outputDir: path.resolve(
      PROJECT_ROOT,
      process.env.OUTPUT_DIR || "output"
    ),
    projectRoot: PROJECT_ROOT,
    isDryRun,
  };
}

export const config = loadConfig();
