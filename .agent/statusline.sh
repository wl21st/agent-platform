#!/usr/bin/env bash
# Universal Antigravity CLI (`agy`) Statusline Script
# Reads JSON from stdin and formats: Repo | Model | Ctx Window | Cache Hit Rate (Read/Write) | Cost | Time

input=$(cat)

if [ -z "$input" ]; then
  exit 0
fi

node -e '
try {
  const raw = process.argv[1];
  if (!raw || !raw.trim()) process.exit(0);
  const data = JSON.parse(raw);

  // Model resolution
  const model = data.model?.display_name || data.model?.name || data.model?.id || data.model || "Antigravity";
  
  // Workspace / Repo resolution
  const repoObj = data.workspace?.repo || data.repo;
  const repo = repoObj ? (repoObj.owner ? `${repoObj.owner}/${repoObj.name}` : repoObj.name || repoObj) : (data.workspace?.current_dir ? data.workspace.current_dir.split("/").pop() : "");
  
  // Context & Token resolution (supporting Antigravity, Gemini, Claude, and OpenAI JSON payloads)
  const ctx = data.context_window || data.context || {};
  const usage = ctx.current_usage || data.usage || data.token_usage || {};
  
  // Tokens
  const inputTokens = usage.input_tokens || usage.prompt_tokens || usage.prompt_token_count || data.input_tokens || 0;
  const outputTokens = usage.output_tokens || usage.completion_tokens || usage.candidates_token_count || data.output_tokens || 0;
  
  // Cache Tokens (read/hit vs write/creation)
  const cacheRead = usage.cache_read_input_tokens || 
                    usage.cached_content_token_count || 
                    usage.prompt_tokens_details?.cached_tokens || 
                    data.cache_read_tokens || 0;
                    
  const cacheWrite = usage.cache_creation_input_tokens || 
                     usage.cache_write_tokens || 0;

  // Total context in use
  const currentTokens = ctx.current_usage_tokens || (inputTokens + cacheRead + cacheWrite);
  
  // Context window size (Gemini is typically 1M - 2M tokens; Claude is 200k)
  const ctxSize = ctx.context_window_size || ctx.max_tokens || 1000000;
  
  let usedPct = 0;
  if (ctx.used_percentage != null) {
    usedPct = ctx.used_percentage <= 1 ? (ctx.used_percentage * 100) : ctx.used_percentage;
  } else if (ctxSize > 0 && currentTokens > 0) {
    usedPct = (currentTokens / ctxSize) * 100;
  }
  const usedPctStr = usedPct.toFixed(1);

  // Cache hit rate: cacheRead / (cacheRead + cacheWrite + non_cached_input)
  const totalCacheEligible = cacheRead + cacheWrite + inputTokens;
  const hitRate = totalCacheEligible > 0 ? ((cacheRead / totalCacheEligible) * 100).toFixed(1) : "0.0";
  const hitNum = parseFloat(hitRate);

  // Number formatting helper (e.g. 14200 -> 14.2k, 1200000 -> 1.20M)
  const fmt = (n) => {
    const num = Number(n) || 0;
    if (num >= 1000000) return (num / 1000000).toFixed(2) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "k";
    return String(num);
  };

  // ANSI styling
  const reset = "\x1b[0m";
  const bold = "\x1b[1m";
  const cyan = "\x1b[36m";
  const yellow = "\x1b[33m";
  const green = "\x1b[32m";
  const red = "\x1b[31m";
  const magenta = "\x1b[35m";
  const dim = "\x1b[2m";

  const parts = [];

  if (repo) parts.push(`${yellow}${bold}${repo}${reset}`);
  if (model) parts.push(`${cyan}${model}${reset}`);

  // Context window badge
  const ctxColor = usedPct >= 80 ? red : usedPct >= 50 ? yellow : green;
  parts.push(`ctx:${ctxColor}${usedPctStr}%${reset} (${fmt(currentTokens)}/${fmt(ctxSize)})`);

  // Cache hit rate & Read/Write tokens
  const hitColor = hitNum >= 70 ? green : hitNum >= 35 ? yellow : (totalCacheEligible > 0 && cacheRead === 0 ? dim : red);
  parts.push(`cache:${hitColor}${hitRate}%${reset} [${magenta}R:${fmt(cacheRead)}${reset} ${magenta}W:${fmt(cacheWrite)}${reset}]`);

  // Cost (if present)
  const costVal = data.cost?.total_cost_usd ?? data.total_cost;
  if (costVal != null && costVal > 0) {
    parts.push(`${magenta}$${Number(costVal).toFixed(4)}${reset}`);
  }

  // Time
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  parts.push(`${dim}${timeStr}${reset}`);

  console.log(parts.join(` ${dim}|${reset} `));
} catch (e) {
  console.log("Antigravity Active");
}
' "$input"
