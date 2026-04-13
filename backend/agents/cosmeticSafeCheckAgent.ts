import { COSMETIC_SAFE_CHECK_AGENT } from '@/lib/agent-chat';
import type { ToolExecutionContext, ToolExecutionResult } from '@backend/agents/toolAgents';

/* ──────────────────────────────────────────────────────────────────────────
 * Ingredient risk database
 *
 * A curated set of cosmetic / skincare ingredients with known safety
 * concerns.  Each entry contains a risk level (high / medium / low) and
 * a short explanation.  The list is intentionally non-exhaustive — the
 * LLM response generator will enrich the analysis with broader context.
 * ─────────────────────────────────────────────────────────────────────── */

interface IngredientRisk {
  /** Canonical lowercase name used for matching */
  name: string;
  /** Human-readable display name */
  displayName: string;
  risk: 'high' | 'medium' | 'low';
  reason: string;
}

const KNOWN_INGREDIENTS: IngredientRisk[] = [
  // ── High-risk ──────────────────────────────────────────────────────────
  { name: 'formaldehyde', displayName: 'Formaldehyde', risk: 'high', reason: 'Known human carcinogen (IARC Group 1). Can cause skin irritation, allergic reactions, and respiratory issues.' },
  { name: 'hydroquinone', displayName: 'Hydroquinone', risk: 'high', reason: 'Banned in many countries for over-the-counter use. Linked to ochronosis (skin darkening), organ toxicity, and potential carcinogenicity with prolonged use.' },
  { name: 'mercury', displayName: 'Mercury', risk: 'high', reason: 'Highly toxic heavy metal. Causes kidney damage, neurological issues, and skin rashes. Banned in cosmetics in many jurisdictions.' },
  { name: 'lead', displayName: 'Lead', risk: 'high', reason: 'Neurotoxin that bioaccumulates. Even trace amounts are a concern; linked to developmental issues and organ damage.' },
  { name: 'lead acetate', displayName: 'Lead Acetate', risk: 'high', reason: 'Toxic lead compound previously used in hair dyes. Banned by the FDA due to neurotoxicity and bioaccumulation.' },
  { name: 'toluene', displayName: 'Toluene', risk: 'high', reason: 'Petrochemical solvent linked to nervous system damage, reproductive harm, and respiratory irritation. Common in nail polish.' },
  { name: 'phthalates', displayName: 'Phthalates', risk: 'high', reason: 'Endocrine disruptors linked to hormonal imbalances, reproductive issues, and developmental problems.' },
  { name: 'dibutyl phthalate', displayName: 'Dibutyl Phthalate (DBP)', risk: 'high', reason: 'Endocrine disruptor linked to reproductive harm. Banned in EU cosmetics.' },
  { name: 'dbp', displayName: 'Dibutyl Phthalate (DBP)', risk: 'high', reason: 'Endocrine disruptor linked to reproductive harm. Banned in EU cosmetics.' },
  { name: 'triclosan', displayName: 'Triclosan', risk: 'high', reason: 'Endocrine disruptor that contributes to antibiotic resistance. Banned in many consumer wash products by the FDA.' },
  { name: 'coal tar', displayName: 'Coal Tar', risk: 'high', reason: 'Known human carcinogen (IARC Group 1). Used in some anti-dandruff shampoos and hair dyes. Linked to skin and lung cancer.' },
  { name: 'parabens', displayName: 'Parabens', risk: 'high', reason: 'Endocrine disruptors that mimic estrogen. Linked to breast cancer risk and reproductive toxicity. Includes methylparaben, propylparaben, butylparaben.' },
  { name: 'methylparaben', displayName: 'Methylparaben', risk: 'high', reason: 'Paraben preservative that mimics estrogen. Associated with endocrine disruption and potential breast cancer risk.' },
  { name: 'propylparaben', displayName: 'Propylparaben', risk: 'high', reason: 'Paraben with stronger estrogenic activity. Linked to endocrine disruption, reproductive issues, and skin sensitization.' },
  { name: 'butylparaben', displayName: 'Butylparaben', risk: 'high', reason: 'One of the most potent estrogen-mimicking parabens. Restricted in EU at higher concentrations.' },
  { name: 'ethylparaben', displayName: 'Ethylparaben', risk: 'high', reason: 'Paraben preservative with estrogenic activity. Potential endocrine disruptor.' },

  // ── Medium-risk ────────────────────────────────────────────────────────
  { name: 'sodium lauryl sulfate', displayName: 'Sodium Lauryl Sulfate (SLS)', risk: 'medium', reason: 'Strong surfactant that can cause skin and eye irritation, dryness, and contact dermatitis in sensitive individuals.' },
  { name: 'sls', displayName: 'Sodium Lauryl Sulfate (SLS)', risk: 'medium', reason: 'Strong surfactant that can cause skin and eye irritation, dryness, and contact dermatitis in sensitive individuals.' },
  { name: 'sodium laureth sulfate', displayName: 'Sodium Laureth Sulfate (SLES)', risk: 'medium', reason: 'Milder than SLS but may be contaminated with 1,4-dioxane (a probable carcinogen) during manufacturing.' },
  { name: 'sles', displayName: 'Sodium Laureth Sulfate (SLES)', risk: 'medium', reason: 'Milder than SLS but may be contaminated with 1,4-dioxane during manufacturing.' },
  { name: 'fragrance', displayName: 'Fragrance / Parfum', risk: 'medium', reason: 'Umbrella term that can hide hundreds of undisclosed chemicals, including allergens and potential endocrine disruptors.' },
  { name: 'parfum', displayName: 'Fragrance / Parfum', risk: 'medium', reason: 'Umbrella term that can hide hundreds of undisclosed chemicals, including allergens and potential endocrine disruptors.' },
  { name: 'oxybenzone', displayName: 'Oxybenzone', risk: 'medium', reason: 'UV filter linked to endocrine disruption and coral reef damage. Absorbed through skin into the bloodstream.' },
  { name: 'octinoxate', displayName: 'Octinoxate', risk: 'medium', reason: 'UV filter with potential hormonal activity. Banned in Hawaii and Key West due to coral reef toxicity.' },
  { name: 'retinyl palmitate', displayName: 'Retinyl Palmitate', risk: 'medium', reason: 'May accelerate skin damage and tumor growth when applied to sun-exposed skin. Should not be used in sunscreen.' },
  { name: 'dea', displayName: 'Diethanolamine (DEA)', risk: 'medium', reason: 'Can react with other ingredients to form carcinogenic nitrosamines. Linked to organ toxicity with prolonged exposure.' },
  { name: 'diethanolamine', displayName: 'Diethanolamine (DEA)', risk: 'medium', reason: 'Can react with other ingredients to form carcinogenic nitrosamines. Linked to organ toxicity.' },
  { name: 'tea', displayName: 'Triethanolamine (TEA)', risk: 'medium', reason: 'pH adjuster that may form carcinogenic nitrosamines when combined with certain preservatives.' },
  { name: 'triethanolamine', displayName: 'Triethanolamine (TEA)', risk: 'medium', reason: 'pH adjuster that may form carcinogenic nitrosamines when combined with certain preservatives.' },
  { name: 'propylene glycol', displayName: 'Propylene Glycol', risk: 'medium', reason: 'Penetration enhancer that can cause skin irritation and allergic contact dermatitis in sensitive individuals.' },
  { name: 'mineral oil', displayName: 'Mineral Oil', risk: 'medium', reason: 'Petroleum-derived occlusive that may contain PAH contaminants. Can clog pores and is an environmental concern.' },
  { name: 'petrolatum', displayName: 'Petrolatum', risk: 'medium', reason: 'Safe when fully refined, but poorly refined petrolatum may contain carcinogenic PAHs. EU requires full refining history.' },
  { name: 'aluminum', displayName: 'Aluminum Compounds', risk: 'medium', reason: 'Used in antiperspirants; some studies suggest links to breast cancer and Alzheimer\'s, though evidence is inconclusive.' },
  { name: 'aluminum chlorohydrate', displayName: 'Aluminum Chlorohydrate', risk: 'medium', reason: 'Active ingredient in antiperspirants with debated links to breast cancer risk.' },
  { name: 'bha', displayName: 'BHA (Butylated Hydroxyanisole)', risk: 'medium', reason: 'Possible human carcinogen (NTP). Can cause skin depigmentation and endocrine disruption at high doses.' },
  { name: 'butylated hydroxyanisole', displayName: 'BHA (Butylated Hydroxyanisole)', risk: 'medium', reason: 'Possible human carcinogen (NTP). Can cause skin depigmentation and endocrine disruption.' },
  { name: 'bht', displayName: 'BHT (Butylated Hydroxytoluene)', risk: 'medium', reason: 'Synthetic antioxidant with possible endocrine disruption and organ toxicity at high concentrations.' },
  { name: 'butylated hydroxytoluene', displayName: 'BHT (Butylated Hydroxytoluene)', risk: 'medium', reason: 'Synthetic antioxidant with possible endocrine disruption and organ toxicity.' },
  { name: 'dimethicone', displayName: 'Dimethicone', risk: 'medium', reason: 'Silicone that can trap debris and bacteria under an occlusive layer, potentially worsening acne. Not biodegradable.' },
  { name: 'phenoxyethanol', displayName: 'Phenoxyethanol', risk: 'medium', reason: 'Preservative generally considered safe at low concentrations (<1%), but can cause irritation and is toxic to infants at higher doses.' },

  // ── Low-risk ───────────────────────────────────────────────────────────
  { name: 'water', displayName: 'Water (Aqua)', risk: 'low', reason: 'Universal solvent. No safety concerns.' },
  { name: 'aqua', displayName: 'Water (Aqua)', risk: 'low', reason: 'Universal solvent. No safety concerns.' },
  { name: 'glycerin', displayName: 'Glycerin', risk: 'low', reason: 'Well-tolerated humectant with an excellent safety profile. Non-irritating for most skin types.' },
  { name: 'hyaluronic acid', displayName: 'Hyaluronic Acid', risk: 'low', reason: 'Naturally occurring in the body. Excellent hydrator with minimal irritation risk.' },
  { name: 'sodium hyaluronate', displayName: 'Sodium Hyaluronate', risk: 'low', reason: 'Salt form of hyaluronic acid. Well-tolerated hydrating ingredient.' },
  { name: 'niacinamide', displayName: 'Niacinamide (Vitamin B3)', risk: 'low', reason: 'Well-studied, well-tolerated active with anti-inflammatory and barrier-strengthening properties.' },
  { name: 'tocopherol', displayName: 'Tocopherol (Vitamin E)', risk: 'low', reason: 'Antioxidant with a strong safety record. Rarely causes contact dermatitis.' },
  { name: 'vitamin e', displayName: 'Tocopherol (Vitamin E)', risk: 'low', reason: 'Antioxidant with a strong safety record. Rarely causes contact dermatitis.' },
  { name: 'aloe vera', displayName: 'Aloe Vera', risk: 'low', reason: 'Soothing plant extract. Generally very safe and well-tolerated topically.' },
  { name: 'aloe barbadensis', displayName: 'Aloe Barbadensis (Aloe Vera)', risk: 'low', reason: 'Soothing plant extract. Generally very safe and well-tolerated topically.' },
  { name: 'shea butter', displayName: 'Shea Butter', risk: 'low', reason: 'Natural emollient rich in fatty acids. Excellent safety profile and well-tolerated.' },
  { name: 'butyrospermum parkii', displayName: 'Shea Butter (Butyrospermum Parkii)', risk: 'low', reason: 'Natural emollient rich in fatty acids. Excellent safety profile.' },
  { name: 'jojoba oil', displayName: 'Jojoba Oil', risk: 'low', reason: 'Plant-derived oil similar to human sebum. Non-comedogenic with excellent tolerability.' },
  { name: 'simmondsia chinensis', displayName: 'Jojoba Oil (Simmondsia Chinensis)', risk: 'low', reason: 'Plant-derived oil similar to human sebum. Non-comedogenic.' },
  { name: 'squalane', displayName: 'Squalane', risk: 'low', reason: 'Lightweight emollient derived from plants or olives. Very well-tolerated and non-irritating.' },
  { name: 'ceramides', displayName: 'Ceramides', risk: 'low', reason: 'Natural skin barrier lipids. Strengthen and restore the skin barrier with no known safety concerns.' },
  { name: 'panthenol', displayName: 'Panthenol (Pro-Vitamin B5)', risk: 'low', reason: 'Well-tolerated moisturizing and soothing ingredient with excellent safety data.' },
  { name: 'allantoin', displayName: 'Allantoin', risk: 'low', reason: 'Gentle soothing and moisturizing agent. Very low irritation potential.' },
  { name: 'centella asiatica', displayName: 'Centella Asiatica (Cica)', risk: 'low', reason: 'Soothing plant extract used for centuries. Anti-inflammatory with a strong safety profile.' },
  { name: 'cica', displayName: 'Centella Asiatica (Cica)', risk: 'low', reason: 'Soothing plant extract. Anti-inflammatory with a strong safety profile.' },
  { name: 'zinc oxide', displayName: 'Zinc Oxide', risk: 'low', reason: 'Mineral sunscreen active considered safe and effective by the FDA. Non-irritating.' },
  { name: 'titanium dioxide', displayName: 'Titanium Dioxide', risk: 'low', reason: 'Mineral sunscreen active. Safe in topical application; inhalation concerns only apply to powder form.' },
  { name: 'salicylic acid', displayName: 'Salicylic Acid', risk: 'low', reason: 'Well-established BHA for acne. Safe at typical cosmetic concentrations (0.5–2%). May cause dryness if overused.' },
  { name: 'citric acid', displayName: 'Citric Acid', risk: 'low', reason: 'Mild AHA / pH adjuster. Very safe at concentrations used in cosmetics.' },
  { name: 'ascorbic acid', displayName: 'Ascorbic Acid (Vitamin C)', risk: 'low', reason: 'Potent antioxidant with well-documented safety. May cause mild tingling on sensitive skin.' },
  { name: 'vitamin c', displayName: 'Ascorbic Acid (Vitamin C)', risk: 'low', reason: 'Potent antioxidant with well-documented safety.' },
  { name: 'retinol', displayName: 'Retinol (Vitamin A)', risk: 'low', reason: 'Effective anti-aging active. Safe at typical cosmetic concentrations but may cause initial irritation. Avoid during pregnancy.' },
  { name: 'glycolic acid', displayName: 'Glycolic Acid', risk: 'low', reason: 'AHA exfoliant. Safe at cosmetic concentrations (up to ~10%). Can increase sun sensitivity.' },
  { name: 'lactic acid', displayName: 'Lactic Acid', risk: 'low', reason: 'Gentle AHA exfoliant. Well-tolerated by most skin types at cosmetic concentrations.' },
  { name: 'green tea', displayName: 'Green Tea Extract', risk: 'low', reason: 'Antioxidant-rich botanical with anti-inflammatory properties. Excellent safety profile.' },
  { name: 'camellia sinensis', displayName: 'Camellia Sinensis (Green Tea)', risk: 'low', reason: 'Antioxidant-rich botanical. Excellent safety profile.' },
  { name: 'chamomile', displayName: 'Chamomile Extract', risk: 'low', reason: 'Soothing anti-inflammatory botanical. Very gentle; rare allergic reactions in those sensitive to Asteraceae family.' },
  { name: 'tea tree oil', displayName: 'Tea Tree Oil', risk: 'low', reason: 'Natural antimicrobial. Safe when properly diluted; can cause contact dermatitis if used undiluted or oxidized.' },
  { name: 'rosehip oil', displayName: 'Rosehip Oil', risk: 'low', reason: 'Rich in essential fatty acids and vitamin A. Gentle and well-tolerated.' },
  { name: 'coconut oil', displayName: 'Coconut Oil', risk: 'low', reason: 'Natural emollient. Generally safe but moderately comedogenic — may clog pores for acne-prone skin.' },
];

/* ──────────────────────────────────────────────────────────────────────────
 * Ingredient parsing helpers
 * ─────────────────────────────────────────────────────────────────────── */

/**
 * Parse a free-form ingredient list into individual ingredient names.
 * Handles comma-separated, newline-separated, and numbered lists.
 */
function parseIngredients(input: string): string[] {
  // Remove common prefixes
  let text = input
    .replace(/^(?:ingredients?|composition|contains|成分|配方|成分表)\s*[:：]?\s*/i, '')
    .trim();

  // Split on commas, newlines, semicolons, or numbered list patterns
  const raw = text.split(/[,;\n]+|(?:\d+\.\s)/);

  return raw
    .map((s) => s.replace(/[()[\]]/g, '').trim())
    .filter((s) => s.length > 0 && s.length < 120);
}

/**
 * Attempt to match a parsed ingredient string against the known database.
 */
function matchIngredient(ingredient: string): IngredientRisk | null {
  const lower = ingredient.toLowerCase().trim();

  // Exact match
  const exact = KNOWN_INGREDIENTS.find((k) => k.name === lower);
  if (exact) return exact;

  // Substring / contains match
  const partial = KNOWN_INGREDIENTS.find(
    (k) => lower.includes(k.name) || k.name.includes(lower),
  );
  if (partial) return partial;

  return null;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Analysis result types
 * ─────────────────────────────────────────────────────────────────────── */

interface AnalyzedIngredient {
  original: string;
  displayName: string;
  risk: 'high' | 'medium' | 'low' | 'unknown';
  reason: string;
}

interface AnalysisResult {
  total: number;
  high: AnalyzedIngredient[];
  medium: AnalyzedIngredient[];
  low: AnalyzedIngredient[];
  unknown: AnalyzedIngredient[];
  overallRisk: 'high' | 'medium' | 'low';
}

function analyzeIngredients(ingredients: string[]): AnalysisResult {
  const analyzed: AnalyzedIngredient[] = ingredients.map((raw) => {
    const match = matchIngredient(raw);
    if (match) {
      return {
        original: raw,
        displayName: match.displayName,
        risk: match.risk,
        reason: match.reason,
      };
    }
    return {
      original: raw,
      displayName: raw,
      risk: 'unknown' as const,
      reason: 'Not found in the safety database. Consider researching this ingredient further.',
    };
  });

  const high = analyzed.filter((a) => a.risk === 'high');
  const medium = analyzed.filter((a) => a.risk === 'medium');
  const low = analyzed.filter((a) => a.risk === 'low');
  const unknown = analyzed.filter((a) => a.risk === 'unknown');

  let overallRisk: 'high' | 'medium' | 'low' = 'low';
  if (high.length > 0) {
    overallRisk = 'high';
  } else if (medium.length > 0) {
    overallRisk = 'medium';
  }

  return { total: ingredients.length, high, medium, low, unknown, overallRisk };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Markdown report builder
 * ─────────────────────────────────────────────────────────────────────── */

function riskEmoji(risk: string) {
  switch (risk) {
    case 'high': return '🔴';
    case 'medium': return '🟡';
    case 'low': return '🟢';
    default: return '⚪';
  }
}

function buildMarkdownReport(result: AnalysisResult): string {
  const lines: string[] = [];

  lines.push('# 🧴 Cosmetic Ingredient Safety Report');
  lines.push('');

  // Overall risk badge
  const badge = `${riskEmoji(result.overallRisk)} **Overall Risk: ${result.overallRisk.toUpperCase()}**`;
  lines.push(badge);
  lines.push('');
  lines.push(`**Total ingredients analyzed:** ${result.total}`);
  lines.push(`- 🔴 High risk: ${result.high.length}`);
  lines.push(`- 🟡 Medium risk: ${result.medium.length}`);
  lines.push(`- 🟢 Low risk: ${result.low.length}`);
  lines.push(`- ⚪ Unknown: ${result.unknown.length}`);
  lines.push('');

  // High-risk section
  if (result.high.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## 🔴 High-Risk Ingredients');
    lines.push('');
    lines.push('These ingredients have significant safety concerns and are flagged by regulatory bodies or scientific studies:');
    lines.push('');
    for (const item of result.high) {
      lines.push(`### ⚠️ ${item.displayName}`);
      lines.push(`> ${item.reason}`);
      lines.push('');
    }
  }

  // Medium-risk section
  if (result.medium.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## 🟡 Medium-Risk Ingredients');
    lines.push('');
    lines.push('These ingredients may cause issues for sensitive individuals or have debated safety profiles:');
    lines.push('');
    for (const item of result.medium) {
      lines.push(`- **${item.displayName}** — ${item.reason}`);
    }
    lines.push('');
  }

  // Low-risk section
  if (result.low.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## 🟢 Low-Risk Ingredients');
    lines.push('');
    for (const item of result.low) {
      lines.push(`- **${item.displayName}** — ${item.reason}`);
    }
    lines.push('');
  }

  // Unknown section
  if (result.unknown.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## ⚪ Unknown Ingredients');
    lines.push('');
    lines.push('These ingredients were not found in our database. They may be safe, but we recommend verifying them:');
    lines.push('');
    for (const item of result.unknown) {
      lines.push(`- ${item.displayName}`);
    }
    lines.push('');
  }

  // Disclaimer
  lines.push('---');
  lines.push('');
  lines.push('> **Disclaimer:** This analysis is for informational purposes only and is not a substitute for professional dermatological advice. Individual sensitivities vary. Always patch-test new products.');
  lines.push('');
  lines.push('*Analyzed by Cosmetic Safe Check Agent*');

  return lines.join('\n');
}

/* ──────────────────────────────────────────────────────────────────────────
 * Cosmetic Safe Check Agent — main execution
 * ─────────────────────────────────────────────────────────────────────── */

export async function runCosmeticSafeCheckAgent(
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const ingredients = parseIngredients(context.input);

  if (ingredients.length === 0) {
    return {
      agent: COSMETIC_SAFE_CHECK_AGENT,
      summary: 'No ingredients detected in the request.',
      markdown: [
        '# 🧴 Cosmetic Safe Check Agent',
        '',
        '⚠️ **No ingredients detected.** Please provide a list of cosmetic or skincare product ingredients to analyze.',
        '',
        'Example: *Water, Glycerin, Niacinamide, Sodium Lauryl Sulfate, Fragrance, Methylparaben*',
      ].join('\n'),
      metadata: { error: 'no_ingredients' },
    };
  }

  const result = analyzeIngredients(ingredients);
  const markdown = buildMarkdownReport(result);

  const summaryParts: string[] = [`Analyzed ${result.total} ingredients.`];
  if (result.high.length > 0) summaryParts.push(`${result.high.length} high-risk.`);
  if (result.medium.length > 0) summaryParts.push(`${result.medium.length} medium-risk.`);
  summaryParts.push(`Overall risk: ${result.overallRisk}.`);

  return {
    agent: COSMETIC_SAFE_CHECK_AGENT,
    summary: summaryParts.join(' '),
    markdown,
    metadata: {
      total: result.total,
      highRiskCount: result.high.length,
      mediumRiskCount: result.medium.length,
      lowRiskCount: result.low.length,
      unknownCount: result.unknown.length,
      overallRisk: result.overallRisk,
      highRiskIngredients: result.high.map((i) => i.displayName),
      mediumRiskIngredients: result.medium.map((i) => i.displayName),
    },
  };
}
