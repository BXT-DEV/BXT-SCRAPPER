// ============================================================
// BXT-SCRAPPER Type Definitions
// ============================================================

export interface BecexProduct {
  sku: string;
  productName: string;
}

export interface AmazonSearchResult {
  title: string;
  price: number | null;
  url: string;
  rating: number | null;
  reviewCount: number | null;
  isPrime: boolean;
}

export interface GeminiMatchResult {
  isMatch: boolean;
  confidence: number;
  matchedResultIndex: number;
  reasoning: string;
}

export interface ScrapedResult {
  sku: string;
  productName: string;
  amazonUrl: string;
  amazonTitle: string;
  amazonPrice: number | null;
  matchConfidence: number;
  status: "matched" | "no_match" | "error";
  errorMessage: string;
}

export interface AmazonProductDetails {
  title: string;
  price: number | null;
  availability: string | null;
}
