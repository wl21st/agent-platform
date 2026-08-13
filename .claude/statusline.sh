#!/usr/bin/env bash
# Claude Code Statusline Script
# Parses session JSON from stdin and prints:
# [Model] | Ctx: Used/Max (Pct%) | Cache Hit: Pct% (R: Read / W: Write) | Cost

input=$(cat)

# If input is empty, exit cleanly
if [ -z "$input" ]; then
  exit 0
fi

# Use Node.js for robust, cross-platform JSON parsing with zero external dependencies
node -e '
try {
  const raw = process.argv[1];
  if (!raw || !raw.trim()) process.exit(0);
  const data = JSON.parse(raw);

  const model = data.model?.display_name || data.model?.id || "Claude";
  
  const ctx = data.context_window || {};
  const usage = ctx.current_usage || data.usage || {};
  
  const inputTokens = usage.input_tokens || data.input_tokens || 0;
  const outputTokens = usage.output_tokens || data.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || data.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || data.cache_creation_input_tokens || 0;
  
  // Total current tokens in context
  const currentTokens = ctx.current_usage_tokens || (inputTokens + cacheRead + cacheWrite);
  const ctxSize = ctx.context_window_size || 200000;
  
  let usedPct = 0;
  if (ctx.used_percentage != null) {
    usedPct = ctx.used_percentage <= 1 ? (ctx.used_percentage * 100) : ctx.used_percentage;
  } else if (ctxSize > 0) {
    usedPct = (currentTokens / ctxSize) * 100;
  }
  const usedPctStr = usedPct.toFixed(1);

  // Cache hit rate: cache_read / (cache_read + cache_write + non_cached_input)
  const totalInputTokens = cacheRead + cacheWrite + inputTokens;
  const hitRate = totalInputTokens > 0 ? ((cacheRead / totalInputTokens) * 100).toFixed(1) : "0.0";
  const hitNum = parseFloat(hitRate);

  // Number formatting helper (e.g. 14200 -> 14.2k)
  const fmt = (n) => {
    const num = Number(n) || 0;
    if (num >= 1000000) return (num / 1000000).toFixed(2) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "k";
    return String(num);
  };

  // ANSI color escapes
  const reset = "\x1b[0m";
  const bold = "\x1b[1m";
  const dim = "\x1b[2m";
  const cyan = "\x1b[36m";
  const green = "\x1b[32m";
  const yellow = "\x1b[33m";
  const red = "\x1b[31m";
  const magenta = "\x1b[35m";

  // Color thresholds
  const hitColor = hitNum >= 70 ? green : hitNum >= 35 ? yellow : (totalInputTokens > 0 && cacheRead === 0 ? dim : red);
  const ctxColor = usedPct >= 80 ? red : usedPct >= 50 ? yellow : green;

  const costVal = data.cost?.total_cost_usd ?? data.total_cost;
  const costStr = (costVal != null && costVal > 0) 
    ? ` ${dim}|${reset} ${magenta}$${Number(costVal).toFixed(4)}${reset}` 
    : "";

  const output = 
    `${cyan}${bold}${model}${reset} ` +
    `${dim}|${reset} Ctx: ${ctxColor}${fmt(currentTokens)}/${fmt(ctxSize)} (${usedPctStr}%)${reset} ` +
    `${dim}|${reset} Cache: ${hitColor}${hitRate}%${reset} ${dim}[R:${fmt(cacheRead)} W:${fmt(cacheWrite)}]${reset}` +
    costStr;

  console.log(output);
} catch (err) {
  // Silent fallback
}
' "$input"
