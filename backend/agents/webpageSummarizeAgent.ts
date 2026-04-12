import { WEBPAGE_SUMMARIZE_AGENT } from '@/lib/agent-chat';
import type { ToolExecutionContext, ToolExecutionResult } from '@backend/agents/toolAgents';

/* ──────────────────────────────────────────────────────────────────────────
 * HTML → plain-text helpers
 * ─────────────────────────────────────────────────────────────────────── */

/**
 * Extract the `<title>` text from raw HTML.
 */
function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.trim().replace(/\s+/g, ' ') || null;
}

/**
 * Extract the meta description content from raw HTML.
 */
function extractMetaDescription(html: string): string | null {
  const match = html.match(
    /<meta[^>]+name\s*=\s*["']description["'][^>]+content\s*=\s*["']([\s\S]*?)["'][^>]*>/i,
  );
  if (match?.[1]?.trim()) return match[1].trim();

  // Also try the reverse attribute order: content before name
  const altMatch = html.match(
    /<meta[^>]+content\s*=\s*["']([\s\S]*?)["'][^>]+name\s*=\s*["']description["'][^>]*>/i,
  );
  return altMatch?.[1]?.trim() || null;
}

/**
 * Strip HTML tags, script/style blocks, and collapse whitespace to produce
 * a readable plain-text representation of the page.
 */
function htmlToPlainText(html: string): string {
  let text = html;

  // Remove script and style blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Convert common block elements to newlines
  text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|section|article|header|footer)[^>]*>/gi, '\n');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '');

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}

/* ──────────────────────────────────────────────────────────────────────────
 * URL extraction helper
 * ─────────────────────────────────────────────────────────────────────── */

/**
 * Extract a URL from free-form user input.
 * Supports both explicit URLs (https://...) and common patterns.
 */
export function extractUrl(input: string, extractedUrl?: string): string | null {
  // Prefer LLM-extracted URL if provided
  if (extractedUrl?.trim()) return extractedUrl.trim();

  // Try matching a URL in the input
  const urlMatch = input.match(/https?:\/\/[^\s,;'"<>)}\]]+/i);
  if (urlMatch) return urlMatch[0];

  // Try matching a bare domain (e.g. "example.com/path")
  const domainMatch = input.match(/(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s,;'"<>)}\]]*)?/i);
  if (domainMatch) return `https://${domainMatch[0]}`;

  return null;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Webpage Summarize Agent — main execution
 * ─────────────────────────────────────────────────────────────────────── */

/** Maximum characters of body text to include in the tool result */
const MAX_BODY_TEXT_LENGTH = 6000;

export async function runWebpageSummarizeAgent(
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const url = extractUrl(context.input, context.extractedUrl);

  if (!url) {
    return {
      agent: WEBPAGE_SUMMARIZE_AGENT,
      summary: 'No valid URL found in the request.',
      markdown: [
        '# Webpage Summarize Agent',
        '',
        '⚠️ **No URL detected.** Please provide a valid URL to summarize.',
        '',
        'Example: *Summarize https://example.com*',
      ].join('\n'),
      metadata: { error: 'no_url' },
    };
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; WebpageSummarizeAgent/1.0; +https://agentsplatform.dev)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml')) {
      return {
        agent: WEBPAGE_SUMMARIZE_AGENT,
        summary: `The URL returned non-HTML content (${contentType}).`,
        markdown: [
          '# Webpage Summarize Agent',
          '',
          `⚠️ **Unsupported content type:** \`${contentType}\``,
          '',
          `The URL \`${url}\` did not return an HTML page. This agent can only summarize HTML web pages.`,
        ].join('\n'),
        metadata: { url, contentType, error: 'unsupported_content_type' },
      };
    }

    const html = await response.text();
    const title = extractTitle(html) || 'Untitled Page';
    const metaDescription = extractMetaDescription(html);
    const bodyText = htmlToPlainText(html);

    // Truncate body text for the LLM context window
    const truncatedBody =
      bodyText.length > MAX_BODY_TEXT_LENGTH
        ? bodyText.slice(0, MAX_BODY_TEXT_LENGTH) + '\n\n[... content truncated ...]'
        : bodyText;

    const summaryLine = metaDescription
      ? `Fetched "${title}" — ${metaDescription}`
      : `Fetched "${title}" (${bodyText.length} characters of text content).`;

    return {
      agent: WEBPAGE_SUMMARIZE_AGENT,
      summary: summaryLine,
      markdown: [
        `# Page Summary: ${title}`,
        '',
        `**Source:** ${url}`,
        metaDescription ? `**Description:** ${metaDescription}` : '',
        '',
        '## Extracted Page Content',
        '',
        truncatedBody || '*No readable text content found on this page.*',
        '',
        '---',
        '',
        'Please summarize the above content with structured sections:',
        '**🔑 Key Points**, **📋 Details** (if needed), and **💡 Overall Takeaway**.',
        '',
        '*Fetched by Webpage Summarize Agent*',
      ]
        .filter((line) => line !== '')
        .join('\n'),
      metadata: {
        url,
        title,
        metaDescription,
        contentLength: bodyText.length,
        truncated: bodyText.length > MAX_BODY_TEXT_LENGTH,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      agent: WEBPAGE_SUMMARIZE_AGENT,
      summary: `Failed to fetch ${url}: ${message}`,
      markdown: [
        '# Webpage Summarize Agent',
        '',
        `❌ **Failed to fetch the webpage.**`,
        '',
        `**URL:** ${url}`,
        `**Error:** ${message}`,
        '',
        'Possible reasons:',
        '- The URL may be invalid or unreachable',
        '- The server may be blocking automated requests',
        '- The request timed out (15 second limit)',
      ].join('\n'),
      metadata: { url, error: message },
    };
  }
}
