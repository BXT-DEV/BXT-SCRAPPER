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

SEARCH RESULTS LIST:
{{SEARCH_RESULTS}}

MATCHING RULES:
1. Brand, Model, and Specs (Storage/RAM) must match exactly.
2. Look at the screenshot to confirm the product image matches the description.
3. If multiple match, pick the best one.
4. If none match, set isMatch to false.

Respond ONLY with a valid JSON object (no markdown):
{
  "isMatch": boolean,
  "confidence": number,
  "matchedResultIndex": number (0-based index from the list),
  "reasoning": "short explanation"
}`;

export class GeminiMatcherService {
  private readonly genAI: GoogleGenAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenAI({ apiKey: apiKey || "dummy" });
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
      return this.parseGeminiResponse(text, searchResults.length);
    } catch (error) {
      logger.error(`Gemini Error: ${(error as Error).message}`);
      return { isMatch: true, confidence: 0.5, matchedResultIndex: 0, reasoning: "AI Error fallback" };
    }
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
