import puppeteer from 'puppeteer';

import { COSMETIC_SAFE_CHECK_AGENT, INGREDIENTS_SCRAPE_AGENT } from '@/lib/agent-chat';
import type { ToolExecutionContext, ToolExecutionResult } from '@backend/agents/toolAgents';
import { extractUrl } from '@backend/agents/webpageSummarizeAgent';
import { runCosmeticSafeCheckAgent } from '@backend/agents/cosmeticSafeCheckAgent';

/* ──────────────────────────────────────────────────────────────────────────
 * Multi-strategy ingredient scraper
 *
 * Strategy 1 — Lightweight HTTP fetch + regex/HTML parsing   (fast, ~2s)
 * Strategy 2 — Headless Puppeteer for JS-rendered pages      (slow, ~10s)
 *
 * Each strategy produces scored Candidate objects. The best candidate
 * across all strategies wins.
 * ─────────────────────────────────────────────────────────────────────── */

/* ── Shared types & constants ─────────────────────────────────────────── */

interface Candidate {
  source: string;
  text: string;
  score: number;
}

const INGREDIENT_LABEL_RE =
  /\b(ingredients?|ingredient\s*list|full\s*ingredients?|full\s*list|composition|formula|inci|what['']?s\s*in\s*it)\b|成分|全成分|配方/i;

const INGREDIENT_TOKEN_HINT_RE =
  /\b(aqua|water|glycerin|parfum|fragrance|niacinamide|butylene\s*glycol|propylene\s*glycol|tocopherol|citric\s*acid|phenoxyethanol|caprylyl\s*glycol|sodium\s*hyaluronate|dimethicone|carbomer|triethanolamine|salicylic\s*acid|lactic\s*acid|glycolic\s*acid|titanium\s*dioxide|retinol|hyaluronic\s*acid|cetearyl\s*alcohol|stearic\s*acid|isopropyl\s*myristate|squalane|panthenol|allantoin|bisabolol|cetyl\s*alcohol)\b/i;

const NOISE_RE =
  /\b(warning|how to use|directions|shipping|reviews|customers also bought|add to cart|you may also like|related products|free shipping|return policy|disclaimer)\b/i;

/* ── Text utilities ───────────────────────────────────────────────────── */

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripHtmlTags(html: string): string {
  // Remove script/style blocks first
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  // Convert block elements to newlines
  text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr|dt|dd|blockquote|section|article)[^>]*>/gi, '\n');
  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '');
  return normalizeWhitespace(text);
}

function countIngredientTokens(text: string): number {
  return text
    .split(/[,;•·\n、，；]+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

function looksLikeIngredientList(text: string): boolean {
  const t = normalizeWhitespace(text);
  if (t.length < 30) return false;

  const tokenCount = countIngredientTokens(t);
  const hasLabel = INGREDIENT_LABEL_RE.test(t);
  const hasChemicalHint = INGREDIENT_TOKEN_HINT_RE.test(t);

  if (tokenCount >= 6 && (hasLabel || hasChemicalHint)) return true;
  if (tokenCount >= 10 && hasChemicalHint) return true;
  if (tokenCount >= 15) return true;

  return false;
}

/* ── Candidate scoring ────────────────────────────────────────────────── */

function scoreCandidate(text: string, source: string): number {
  const t = normalizeWhitespace(text);
  let score = 0;

  // Label presence
  if (INGREDIENT_LABEL_RE.test(t)) score += 20;
  // Chemical hint presence
  if (INGREDIENT_TOKEN_HINT_RE.test(t)) score += 20;

  // Token density
  const tokenCount = countIngredientTokens(t);
  score += Math.min(tokenCount * 2, 40);

  // Reasonable length bonuses
  if (t.length > 60) score += 5;
  if (t.length > 150) score += 10;
  if (t.length > 300) score += 5;

  // Penalize very long texts (likely full page content)
  if (t.length > 3000) score -= 15;
  if (t.length > 5000) score -= 30;

  // Penalize noise
  if (NOISE_RE.test(t)) score -= 20;

  // Source bonuses
  if (source.includes('json-ld')) score += 25;
  if (source.includes('meta')) score += 15;
  if (source.includes('heading')) score += 15;
  if (source.includes('class-match')) score += 12;
  if (source.includes('itemprop')) score += 18;
  if (source.includes('id-match')) score += 12;

  return score;
}

/* ── Ingredient display formatting ────────────────────────────────────── */

/**
 * Format raw ingredient text as a readable markdown list.
 * Splits the comma/semicolon-separated string into individual items.
 */
function formatIngredientsAsMarkdownList(raw: string): string {
  const items = raw
    .split(/[,;•·、，；]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (items.length === 0) return raw;

  // Number each ingredient for easy reading
  return items
    .map((item, index) => `${index + 1}. ${item}`)
    .join('\n');
}

/* ── Ingredient text cleanup ──────────────────────────────────────────── */

function cleanIngredientText(raw: string): string {
  let text = stripHtmlTags(raw);
  text = normalizeWhitespace(text);

  // Strip leading label like "Ingredients:" or "Full Ingredient List\n"
  const labelMatch = text.match(
    /(?:ingredients?|ingredient\s*list|full\s*ingredients?|full\s*list|composition|formula|inci|成分|全成分|配方)\s*[:：\n]\s*([\s\S]+)/i,
  );
  if (labelMatch?.[1]) text = labelMatch[1].trim();

  // Remove UI noise
  text = text
    .replace(/\b(click to expand|show more|see more|view all|read more|less info)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // If multiple lines, keep only the ingredient-dense ones
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 1) {
    const denseLines = lines.filter(
      (line) => looksLikeIngredientList(line) || /[,;•·、，；]/.test(line),
    );
    if (denseLines.length > 0) {
      text = denseLines.join('\n');
    }
  }

  return text.trim();
}

/* ──────────────────────────────────────────────────────────────────────────
 * Strategy 1: Lightweight HTTP fetch + regex/HTML parsing
 *
 * Extracts ingredients from:
 *   - JSON-LD structured data (schema.org Product)
 *   - <meta> tags with ingredient content
 *   - Elements with ingredient-related class/id names
 *   - Heading + sibling text patterns
 *   - Regex scan of raw HTML
 * ─────────────────────────────────────────────────────────────────────── */

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.text();
}

/** Extract ingredient candidates from JSON-LD structured data */
function extractFromJsonLd(html: string): Candidate[] {
  const candidates: Candidate[] = [];
  const scriptRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        // Check for direct ingredient fields
        for (const key of ['ingredients', 'ingredient', 'recipeIngredient', 'description']) {
          const value = item[key];
          if (!value) continue;

          const text = Array.isArray(value) ? value.join(', ') : String(value);
          if (INGREDIENT_LABEL_RE.test(text) || INGREDIENT_TOKEN_HINT_RE.test(text)) {
            candidates.push({
              source: `json-ld:${key}`,
              text: cleanIngredientText(text),
              score: scoreCandidate(text, `json-ld:${key}`),
            });
          }
        }

        // Recursively check nested objects (e.g. Product > additionalProperty)
        const jsonStr = JSON.stringify(item);
        if (INGREDIENT_LABEL_RE.test(jsonStr) && INGREDIENT_TOKEN_HINT_RE.test(jsonStr)) {
          // Try extracting value from additionalProperty patterns
          const addProps = item.additionalProperty || item.hasProperty || [];
          const propArray = Array.isArray(addProps) ? addProps : [addProps];
          for (const prop of propArray) {
            if (prop?.name && INGREDIENT_LABEL_RE.test(String(prop.name)) && prop.value) {
              const text = String(prop.value);
              candidates.push({
                source: 'json-ld:additionalProperty',
                text: cleanIngredientText(text),
                score: scoreCandidate(text, 'json-ld:additionalProperty'),
              });
            }
          }
        }
      }
    } catch {
      // Invalid JSON — skip
    }
  }

  return candidates;
}

/** Extract from <meta> tags (some sites put ingredients in meta content) */
function extractFromMetaTags(html: string): Candidate[] {
  const candidates: Candidate[] = [];
  const metaRe = /<meta[^>]+(?:name|property)\s*=\s*["']([^"']+)["'][^>]+content\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaRe.exec(html)) !== null) {
    const name = match[1];
    const content = match[2];
    if (
      INGREDIENT_LABEL_RE.test(name) ||
      (INGREDIENT_LABEL_RE.test(content) && INGREDIENT_TOKEN_HINT_RE.test(content))
    ) {
      const text = cleanIngredientText(content);
      if (text.length > 30) {
        candidates.push({
          source: `meta:${name}`,
          text,
          score: scoreCandidate(content, 'meta'),
        });
      }
    }
  }

  return candidates;
}

/** Extract from elements with ingredient-related class/id attributes */
function extractFromClassAndIdPatterns(html: string): Candidate[] {
  const candidates: Candidate[] = [];

  // Match elements whose class or id contains "ingredient"
  const patterns = [
    // class="...ingredient..."
    /<(?:div|p|span|section|ul|ol|article|td|dd)[^>]*class\s*=\s*["'][^"']*ingredient[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p|span|section|ul|ol|article|td|dd)>/gi,
    // id="...ingredient..."
    /<(?:div|p|span|section|ul|ol|article|td|dd)[^>]*id\s*=\s*["'][^"']*ingredient[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p|span|section|ul|ol|article|td|dd)>/gi,
    // itemprop="ingredients"
    /<[^>]*itemprop\s*=\s*["'][^"']*ingredient[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi,
    // data-* attributes with ingredient
    /<[^>]*data-[a-z-]*ingredient[^>]*>([\s\S]*?)<\/[^>]+>/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const rawContent = match[1];
      if (!rawContent) continue;

      const text = cleanIngredientText(rawContent);
      if (text.length > 30) {
        const sourceType = pattern.source.includes('itemprop')
          ? 'itemprop'
          : pattern.source.includes('id=')
            ? 'id-match'
            : 'class-match';
        candidates.push({
          source: sourceType,
          text,
          score: scoreCandidate(text, sourceType),
        });
      }
    }
  }

  return candidates;
}

/**
 * Extract from heading + following content patterns.
 * e.g., <h3>Ingredients</h3><p>Water, Glycerin, ...</p>
 */
function extractFromHeadingPatterns(html: string): Candidate[] {
  const candidates: Candidate[] = [];

  // Match headings or bold/strong that contain ingredient labels
  const headingRe =
    /<(?:h[1-6]|strong|b|dt|summary|label)[^>]*>[^<]*?(?:ingredient|composition|formula|inci|成分|配方)[^<]*?<\/(?:h[1-6]|strong|b|dt|summary|label)>\s*([\s\S]{30,3000}?)(?=<(?:h[1-6]|strong|b|dt|summary|label|footer|script|style)\b|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(html)) !== null) {
    const content = match[1];
    if (!content) continue;

    const text = cleanIngredientText(content);
    if (text.length > 30 && looksLikeIngredientList(text)) {
      candidates.push({
        source: 'heading-sibling',
        text,
        score: scoreCandidate(text, 'heading'),
      });
    }
  }

  return candidates;
}

/** Regex-based scan of full page text for comma-separated chemical lists */
function extractFromFullTextScan(html: string): Candidate[] {
  const candidates: Candidate[] = [];
  const plainText = stripHtmlTags(html);

  // Look for the label followed by a comma-separated list
  const labelPatterns = [
    /(?:ingredients?|full\s*ingredients?|composition|inci)\s*[:：]\s*((?:[A-Za-z][\w\s()-]*(?:\/[A-Za-z][\w\s()-]*)*,\s*){5,}[A-Za-z][\w\s()-]*(?:\/[A-Za-z][\w\s()-]*)*)\.?/gi,
    /(?:成分|全成分|配方)\s*[:：]?\s*([\s\S]{40,2000})/gi,
  ];

  for (const pattern of labelPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(plainText)) !== null) {
      const text = cleanIngredientText(match[1] || match[0]);
      if (text.length > 30 && looksLikeIngredientList(text)) {
        candidates.push({
          source: 'full-text-scan',
          text,
          score: scoreCandidate(text, 'full-text-scan'),
        });
      }
    }
  }

  return candidates;
}

/** Strategy 1: aggregate all HTTP-based extraction methods */
async function scrapeViaHttp(url: string): Promise<Candidate[]> {
  console.log('[IngredientsScrapeAgent] Strategy 1: HTTP fetch + HTML parsing for:', url);

  const html = await fetchHtml(url);
  console.log(`[IngredientsScrapeAgent] Fetched ${html.length} chars of HTML`);

  const allCandidates = [
    ...extractFromJsonLd(html),
    ...extractFromMetaTags(html),
    ...extractFromClassAndIdPatterns(html),
    ...extractFromHeadingPatterns(html),
    ...extractFromFullTextScan(html),
  ];

  return deduplicateCandidates(allCandidates);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Strategy 2: Puppeteer-based headless browser scraping
 *
 * For JS-rendered pages, SPAs, and sites that block plain HTTP requests.
 * Launches a real headless Chromium browser, scrolls, expands accordions,
 * and extracts ingredient text from the live DOM.
 * ─────────────────────────────────────────────────────────────────────── */

async function scrapeViaPuppeteer(url: string): Promise<Candidate[]> {
  console.log('[IngredientsScrapeAgent] Strategy 2: Puppeteer headless browser for:', url);

  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-setuid-sandbox',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    );
    await page.setViewport({ width: 1440, height: 900 });
    await page.setDefaultTimeout(30_000);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    // Wait for initial dynamic content
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // ── Scroll through the page to trigger lazy-loading ─────────────
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        let totalHeight = 0;
        let sameCount = 0;
        let lastHeight = 0;
        const timer = setInterval(() => {
          const h = document.body.scrollHeight;
          window.scrollBy(0, 400);
          totalHeight += 400;
          if (h === lastHeight) sameCount++;
          else { sameCount = 0; lastHeight = h; }
          if (sameCount >= 3 || totalHeight > h + 2000) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
        }, 200);
      });
    });

    // ── Click ingredient-related expand/toggle buttons ────────────
    await page.evaluate(() => {
      const labelRe =
        /\b(ingredients?|ingredient list|full ingredients?|composition|formula|inci|what'?s in it|show more|see more|view all|details|product details)\b|成分|全成分|配方/i;

      const clickables = document.querySelectorAll(
        'button, a, summary, [role="button"], [role="tab"], [aria-expanded], details, [class*="accordion"], [class*="toggle"], [class*="expand"], [class*="collapse"], [class*="tab"]',
      );

      for (const el of clickables) {
        const text = (el.textContent || '').trim();
        const ariaLabel = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        const combined = `${text} ${ariaLabel} ${title}`;

        if (labelRe.test(combined)) {
          try { (el as HTMLElement).click(); } catch { /* ignore */ }
        }
      }

      // Open all <details> elements
      for (const d of Array.from(document.querySelectorAll('details:not([open])'))) {
        try { (d as HTMLDetailsElement).open = true; } catch { /* ignore */ }
      }
    });

    // Wait for expanded content
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // ── Collect candidates from the live DOM ─────────────────────
    const raw = await page.evaluate(() => {
      const results: Array<{ source: string; text: string }> = [];
      const norm = (s: string) => s.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
      const labelRe =
        /\b(ingredients?|ingredient list|full ingredients?|composition|formula|inci|what'?s in it)\b|成分|全成分|配方/i;

      const add = (source: string, text?: string | null) => {
        const v = norm(text || '');
        if (v && v.length >= 30) results.push({ source, text: v });
      };

      // 1) Elements with ingredient-related class/id
      const classIdEls = document.querySelectorAll(
        '[class*="ingredient" i], [id*="ingredient" i], [itemprop*="ingredient" i], [data-ingredients], [class*="inci" i]',
      );
      for (const el of classIdEls) {
        add('dom:class-match', el.textContent);
      }

      // 2) Headings containing ingredient labels → grab sibling/parent content
      const headings = document.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b,dt,summary,button,label');
      for (const h of headings) {
        const hText = norm(h.textContent || '');
        if (!labelRe.test(hText)) continue;

        add('dom:heading-self', h.textContent);
        if (h.nextElementSibling) add('dom:heading-next', h.nextElementSibling.textContent);

        const parent = h.parentElement;
        if (parent) {
          add('dom:heading-parent', parent.textContent);
          if (parent.nextElementSibling) add('dom:heading-parentNext', parent.nextElementSibling.textContent);
        }

        const container = h.closest('section, article, div, li, details, td, dd');
        if (container) add('dom:heading-container', container.textContent);
      }

      // 3) Any elements whose text matches the ingredient label and has comma-heavy content
      const allEls = document.querySelectorAll('div, p, span, li, section, article, td, dd');
      for (const el of allEls) {
        const text = norm(el.textContent || '');
        if (text.length < 40 || text.length > 5000) continue;
        if (!labelRe.test(text)) continue;

        const commaCount = (text.match(/,/g) || []).length;
        if (commaCount >= 5) {
          add('dom:labelled-node', text);
        }
      }

      // 4) JSON-LD from live DOM
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        const txt = script.textContent || '';
        if (labelRe.test(txt)) add('dom:json-ld', txt);
      }

      return results;
    });

    // Score and filter
    const candidates = raw
      .map(({ source, text }) => ({
        source,
        text: cleanIngredientText(text),
        score: scoreCandidate(text, source),
      }))
      .filter((c) => looksLikeIngredientList(c.text));

    return deduplicateCandidates(candidates);
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
      console.log('[IngredientsScrapeAgent] Browser closed');
    }
  }
}

/* ── Deduplication ────────────────────────────────────────────────────── */

function deduplicateCandidates(candidates: Candidate[]): Candidate[] {
  const dedup = new Map<string, Candidate>();
  for (const c of candidates) {
    // Use a normalized key (first 200 chars lowercase) for dedup
    const key = c.text.toLowerCase().slice(0, 200);
    const prev = dedup.get(key);
    if (!prev || c.score > prev.score) {
      dedup.set(key, c);
    }
  }

  return [...dedup.values()].sort((a, b) => b.score - a.score);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Main scrape orchestration
 *
 * 1. Try lightweight HTTP fetch first
 * 2. If no confident result, fall back to Puppeteer
 * 3. Return the best candidate across both strategies
 * ─────────────────────────────────────────────────────────────────────── */

const MIN_CONFIDENT_SCORE = 40;

async function scrapeIngredients(url: string): Promise<{
  ingredientText: string | null;
  candidates: Candidate[];
  strategy: string;
}> {
  let allCandidates: Candidate[] = [];
  let strategy = 'none';

  // ── Strategy 1: HTTP fetch ──────────────────────────────────────────
  try {
    const httpCandidates = await scrapeViaHttp(url);
    allCandidates.push(...httpCandidates);

    console.log(`[IngredientsScrapeAgent] HTTP strategy found ${httpCandidates.length} candidates`);
    if (httpCandidates.length > 0) {
      console.log(`[IngredientsScrapeAgent] Best HTTP candidate score: ${httpCandidates[0].score} (source: ${httpCandidates[0].source})`);
    }

    // If we have a confident result, skip Puppeteer
    if (httpCandidates.length > 0 && httpCandidates[0].score >= MIN_CONFIDENT_SCORE) {
      strategy = `http:${httpCandidates[0].source}`;
      return {
        ingredientText: httpCandidates[0].text,
        candidates: httpCandidates,
        strategy,
      };
    }
  } catch (httpError) {
    const msg = httpError instanceof Error ? httpError.message : String(httpError);
    console.log(`[IngredientsScrapeAgent] HTTP strategy failed: ${msg}`);
  }

  // ── Strategy 2: Puppeteer fallback ──────────────────────────────────
  try {
    const puppeteerCandidates = await scrapeViaPuppeteer(url);
    allCandidates.push(...puppeteerCandidates);

    console.log(`[IngredientsScrapeAgent] Puppeteer strategy found ${puppeteerCandidates.length} candidates`);
    if (puppeteerCandidates.length > 0) {
      console.log(`[IngredientsScrapeAgent] Best Puppeteer candidate score: ${puppeteerCandidates[0].score} (source: ${puppeteerCandidates[0].source})`);
    }
  } catch (puppeteerError) {
    const msg = puppeteerError instanceof Error ? puppeteerError.message : String(puppeteerError);
    console.log(`[IngredientsScrapeAgent] Puppeteer strategy failed: ${msg}`);
  }

  // ── Pick best across all strategies ─────────────────────────────────
  const sorted = deduplicateCandidates(allCandidates);

  if (sorted.length > 0 && sorted[0].score >= MIN_CONFIDENT_SCORE) {
    strategy = sorted[0].source;
    return {
      ingredientText: sorted[0].text,
      candidates: sorted,
      strategy,
    };
  }

  // Even without confident score, return the best we have
  if (sorted.length > 0) {
    strategy = `low-confidence:${sorted[0].source}`;
    return {
      ingredientText: sorted[0].text,
      candidates: sorted,
      strategy,
    };
  }

  return { ingredientText: null, candidates: sorted, strategy };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Scrape-only entry point (no safety check)
 *
 * Used by the orchestrator for the two-step workflow where
 * scraping and safety analysis are streamed as separate tasks.
 * ─────────────────────────────────────────────────────────────────────── */

export interface IngredientScrapeOnlyResult {
  url: string;
  ingredientText: string | null;
  strategy: string;
  candidateCount: number;
  /** Pre-built tool result for the scrape step (used by orchestrator) */
  toolResult: ToolExecutionResult;
}

export async function scrapeIngredientsOnly(
  context: ToolExecutionContext,
): Promise<IngredientScrapeOnlyResult> {
  const url = extractUrl(context.input, context.extractedUrl);

  if (!url) {
    return {
      url: '',
      ingredientText: null,
      strategy: 'none',
      candidateCount: 0,
      toolResult: {
        agent: INGREDIENTS_SCRAPE_AGENT,
        summary: 'No valid URL found in the request.',
        markdown: [
          '# 🔬 Ingredients Scrape Agent',
          '',
          '⚠️ **No URL detected.** Please provide a valid product page URL to scrape ingredients from.',
          '',
          'Example: *Scrape ingredients from https://example.com/product*',
        ].join('\n'),
        metadata: { error: 'no_url' },
      },
    };
  }

  try {
    const { ingredientText, candidates, strategy } = await scrapeIngredients(url);
    console.log(`[IngredientsScrapeAgent] Final strategy: ${strategy}, found: ${!!ingredientText}`);

    if (!ingredientText) {
      return {
        url,
        ingredientText: null,
        strategy,
        candidateCount: candidates.length,
        toolResult: {
          agent: INGREDIENTS_SCRAPE_AGENT,
          summary: `Could not find ingredients on the page: ${url}`,
          markdown: [
            '# 🔬 Ingredients Scrape Agent',
            '',
            `**Source:** ${url}`,
            '',
            '⚠️ **No ingredient list found on this page.**',
            '',
            candidates.length > 0
              ? [
                  '## Top candidates detected (low confidence)',
                  '',
                  ...candidates.slice(0, 3).flatMap((c, i) => [
                    `### Candidate ${i + 1} — ${c.source} (score: ${c.score})`,
                    '```',
                    c.text.slice(0, 500),
                    '```',
                    '',
                  ]),
                ].join('\n')
              : '',
            'The agent could not locate a recognizable ingredient list. This may happen if:',
            '- The ingredients are in an image rather than text',
            '- The page structure is unusual or uses non-standard markup',
            '- The content is behind a login or age gate',
            '',
            'You can try:',
            '- Providing the ingredients manually to the **Cosmetic Safe Check Agent**',
            '- Trying a different product page URL',
          ].join('\n'),
          metadata: {
            url,
            strategy,
            error: 'no_ingredients_found',
            candidateCount: candidates.length,
          },
        },
      };
    }

    return {
      url,
      ingredientText,
      strategy,
      candidateCount: candidates.length,
      toolResult: {
        agent: INGREDIENTS_SCRAPE_AGENT,
        summary: `Scraped ingredients from ${url} (${strategy}).`,
        markdown: [
          '# 🔬 Ingredients Scrape Agent',
          '',
          `**Source:** ${url}`,
          `**Extraction method:** ${strategy}`,
          '',
          '## Extracted Ingredients',
          '',
          '```',
          ingredientText,
          '```',
        ].join('\n'),
        metadata: {
          url,
          strategy,
          ingredientText,
          candidatesChecked: candidates.length,
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[IngredientsScrapeAgent] Error:', message);

    return {
      url: url || '',
      ingredientText: null,
      strategy: 'error',
      candidateCount: 0,
      toolResult: {
        agent: INGREDIENTS_SCRAPE_AGENT,
        summary: `Failed to extract ingredients from ${url}: ${message}`,
        markdown: [
          '# 🔬 Ingredients Scrape Agent',
          '',
          '❌ **Failed to process the webpage.**',
          '',
          `**URL:** ${url}`,
          `**Error:** ${message}`,
          '',
          'Possible reasons:',
          '- The URL may be invalid or unreachable',
          '- The server may be blocking automated requests',
          '- The request timed out',
          '- Puppeteer / Chromium may not be available on this system',
        ].join('\n'),
        metadata: { url, error: message },
      },
    };
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Build combined scrape + safety report (used by orchestrator after
 * running both steps separately with intermediate streaming)
 * ─────────────────────────────────────────────────────────────────────── */

export function buildCombinedScrapeAndSafetyResult(
  scrapeResult: IngredientScrapeOnlyResult,
  safetyResult: ToolExecutionResult,
): ToolExecutionResult {
  return {
    agent: INGREDIENTS_SCRAPE_AGENT,
    summary: `${scrapeResult.toolResult.summary} ${safetyResult.summary}`,
    markdown: [
      '# 🔬 Ingredients Scrape & Safety Report',
      '',
      `**Source:** ${scrapeResult.url}`,
      `**Extraction method:** ${scrapeResult.strategy}`,
      '',
      '## Extracted Ingredients',
      '',
      '```',
      scrapeResult.ingredientText || '',
      '```',
      '',
      '---',
      '',
      safetyResult.markdown,
    ].join('\n'),
    metadata: {
      url: scrapeResult.url,
      strategy: scrapeResult.strategy,
      ingredientText: scrapeResult.ingredientText,
      candidatesChecked: scrapeResult.candidateCount,
      safetyAnalysis: safetyResult.metadata,
    },
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Full pipeline entry point (backward compat — runs scrape + safety)
 * ─────────────────────────────────────────────────────────────────────── */

export async function runIngredientsScrapeAgent(
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const scrapeResult = await scrapeIngredientsOnly(context);

  if (!scrapeResult.ingredientText) {
    return scrapeResult.toolResult;
  }

  console.log(`[IngredientsScrapeAgent] Extracted ingredients (${scrapeResult.ingredientText.length} chars), running safety check...`);

  const safetyResult = await runCosmeticSafeCheckAgent({
    ...context,
    input: scrapeResult.ingredientText,
  });

  return buildCombinedScrapeAndSafetyResult(scrapeResult, safetyResult);
}
