// ============================================================
// Environment Configuration Loader
// Validates and exports typed config from .env
// ============================================================

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import type { ScraperTarget, MappingCategory } from "../types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// When using pkg, process.pkg is defined. 
// We want PROJECT_ROOT to be the folder where the .exe is located for .env, input/ and output/.
const isPackaged = (process as any).pkg !== undefined;
const PROJECT_ROOT = isPackaged 
  ? process.cwd() 
  : path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

interface AppConfig {
  mappingCategory: MappingCategory;
  geminiApiKey: string;
  proxyUrl: string | null;
  amazonDomain: string;
  jbhifiDomain: string;
  koganDomain: string;
  phonebotDomain: string;
  reebeloDomain: string;
  backmarketDomain: string;
  mobilecitiDomain: string;
  buymobileDomain: string;
  spectronicDomain: string;
  bestmobilephoneDomain: string;
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
    mappingCategory: (process.env.MAPPING_CATEGORY as any) || "MAPPING BRAND NEW",
    geminiApiKey,
    proxyUrl: process.env.PROXY_URL || null,
    amazonDomain: process.env.AMAZON_DOMAIN || "amazon.com.au",
    jbhifiDomain: process.env.JBHIFI_DOMAIN || "www.jbhifi.com.au",
    phonebotDomain: process.env.PHONEBOT_DOMAIN || "www.phonebot.com.au",
    koganDomain: process.env.KOGAN_DOMAIN || "www.kogan.com.au",
    reebeloDomain: process.env.REEBELO_DOMAIN || "reebelo.com.au",
    backmarketDomain: process.env.BACKMARKET_DOMAIN || "www.backmarket.com.au",
    mobilecitiDomain: process.env.MOBILECITI_DOMAIN || "www.mobileciti.com.au",
    buymobileDomain: process.env.BUYMOBILE_DOMAIN || "buymobile.com.au",
    spectronicDomain: process.env.SPECTRONIC_DOMAIN || "spectronic.com.au",
    bestmobilephoneDomain: process.env.BESTMOBILEPHONE_DOMAIN || "bestmobilephone.com.au",
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
