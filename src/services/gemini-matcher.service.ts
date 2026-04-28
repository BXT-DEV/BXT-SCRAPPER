// ============================================================
// Gemini Matcher Service
// Uses Google Gemini AI to intelligently match products (Vision-enabled)
// ============================================================

import { GoogleGenAI } from "@google/genai";
import type { BecexProduct, AmazonSearchResult, GeminiMatchResult } from "../types/index.js";
import { logger } from "../utils/logger.js";

const MATCH_PROMPT_TEMPLATE = `You are a product matching expert. Your job is to determine which search result in the provided SCREENSHOT and LIST is the EXACT SAME product as the source product.

SOURCE PRODUCT:
Name: {{PRODUCT_NAME}}
SKU: {{PRODUCT_SKU}}

SEARCH RESULTS LIST:
{{SEARCH_RESULTS}}

CURRENT MAPPING CATEGORY: {{MAPPING_CATEGORY}}

CRITICAL MATCHING RULES:
1. **STORAGE & COLOR ARE ABSOLUTE**: If the source says "Titanium Blue" and the result says "Titanium Grey", it is NOT a match. If the source says "1TB" and the result says "512GB", it is NOT a match.
2. **EXACT KEYWORDS**: Look for exact matches for storage (e.g., 128GB, 256GB, 512GB, 1TB) and color names.
3. **CONDITION MATCHING**: For Refurbished, ensure the condition (Excellent/Pristine) matches the mapping rules provided below.
4. If multiple match, pick the one that matches the title most closely.
5. If none match or color/specs differ, set isMatch to false.

CRITICAL MAPPING RULES (MUST FOLLOW STRICTLY):
- For REFURBISHED items (Source SKU ends in "-VR-ASN-AU" for Pristine, "-RD-VR-EXD-AU" for Excellent):
  * Reebelo: Pristine -> Premium, Excellent -> Excellent. ONLY Standard Battery & Physical SIM.
  * Backmarket: Pristine -> Excellent, Excellent -> Good. ONLY Physical SIM.
  * Amazon: DO NOT map Pristine items to Amazon. Excellent -> MATCH ONLY Excellent or Renewed (Renewed = Excellent). 
    - REJECT if: Any bonus accessories (earphones, case, brick), Australian Version/AU Stock, Warranty > 6 months, Pre-orders.
- For BRAND NEW items:
  * Amazon: NO bonus accessories, NO Australian version/stock, NO pre-orders, Warranty <= 1 year.

Respond ONLY with a valid JSON object:
{
  "isMatch": boolean,
  "confidence": number,
  "matchedResultIndex": number (0-based index from the list),
  "reasoning": "short explanation highlighting why storage/color/condition matches"
}`;

export class GeminiMatcherService {
  private readonly genAI: GoogleGenAI;
  private readonly mappingCategory: string;

  constructor(apiKey: string, mappingCategory: string) {
    this.genAI = new GoogleGenAI({ apiKey: apiKey || "dummy" });
    this.mappingCategory = mappingCategory;
  }

  async findBestMatch(
    becexProduct: BecexProduct,
    searchResults: AmazonSearchResult[],
    screenshotBuffer?: Buffer
  ): Promise<GeminiMatchResult> {
    if (!process.env.GEMINI_API_KEY) {
      logger.warn("No Gemini API key found. Falling back to first search result.");
      return { isMatch: true, confidence: 1, matchedResultIndex: 0, reasoning: "Fallback (No AI Key)" };
    }

    const formattedResults = searchResults
      .map((r, i) => `[${i}] "${r.title}" — Price: ${r.price || "N/A"}`)
      .join("\n");

    const promptText = MATCH_PROMPT_TEMPLATE
      .replace("{{PRODUCT_NAME}}", becexProduct.productName)
      .replace("{{PRODUCT_SKU}}", becexProduct.sku)
      .replace("{{MAPPING_CATEGORY}}", this.mappingCategory)
      .replace("{{SEARCH_RESULTS}}", formattedResults);

    try {
      const contents: any[] = [{ role: "user", parts: [{ text: promptText }] }];
      
      if (screenshotBuffer) {
        contents[0].parts.push({
          inlineData: {
            data: screenshotBuffer.toString("base64"),
            mimeType: "image/png"
          }
        });
      }

      const response = await this.genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents,
        config: {
          temperature: 0.1,
          maxOutputTokens: 1000
        }
      });

      const text = response.text || "";
      const match = this.parseGeminiResponse(text, searchResults.length);

      // --- Post-Verification (Zero-Debt Safety Net) ---
      if (match.isMatch && match.matchedResultIndex >= 0) {
        const result = searchResults[match.matchedResultIndex];
        const isVerified = this.verifyMatchConsistency(becexProduct.productName, result.title);
        if (!isVerified) {
          logger.warn(`Gemini match REJECTED by local verification for: ${becexProduct.productName} -> ${result.title}`);
          return { isMatch: false, confidence: 0, matchedResultIndex: -1, reasoning: "Rejected by local verification (Color/Storage mismatch)" };
        }
      }

      return match;
    } catch (error) {
      logger.error(`Gemini Error: ${(error as Error).message}`);
      return { isMatch: true, confidence: 0.5, matchedResultIndex: 0, reasoning: "AI Error fallback" };
    }
  }

  private verifyMatchConsistency(sourceName: string, targetTitle: string): boolean {
    const sourceLower = sourceName.toLowerCase();
    const targetLower = targetTitle.toLowerCase();

    // 1. Storage Check (e.g., 128GB, 1TB)
    const storagePattern = /\b(\d+(?:GB|TB))\b/gi;
    const sourceStorages = sourceName.match(storagePattern) || [];
    for (const storage of sourceStorages) {
      if (!targetLower.includes(storage.toLowerCase())) return false;
    }

    // 2. Color Check
    // Extract color names from common patterns like "(128GB, Blue)" or "Titanium Grey"
    const commonColors = [
      "blue", "grey", "gray", "black", "white", "silver", "gold", "green", "pink", "purple", "violet", "orange", "yellow", "cream", "natural", "titanium"
    ];
    
    for (const color of commonColors) {
      if (sourceLower.includes(color)) {
        // If source mentions a specific color, target must also mention it (or a close variant)
        // Exception: if source mentions "Titanium Blue", target must mention "Blue"
        if (!targetLower.includes(color)) {
          // Special case for Grey/Gray
          if (color === "grey" && targetLower.includes("gray")) continue;
          if (color === "gray" && targetLower.includes("grey")) continue;
          return false;
        }
      }
    }

    return true;
  }

  private parseGeminiResponse(responseText: string, maxResults: number): GeminiMatchResult {
    try {
      const cleaned = responseText.replace(/```json\s?|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      let index = parseInt(parsed.matchedResultIndex);
      if (isNaN(index) || index < 0 || index >= maxResults) index = 0;

      return {
        isMatch: !!parsed.isMatch,
        confidence: parsed.confidence || 0,
        matchedResultIndex: index,
        reasoning: parsed.reasoning || ""
      };
    } catch {
      return { isMatch: true, confidence: 0, matchedResultIndex: 0, reasoning: "Parse error fallback" };
    }
  }
}
