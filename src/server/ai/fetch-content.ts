import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { safeFetch, SsrfBlockedError } from "@/server/ai/safe-fetch";
import { logger } from "@/server/logger";

interface FetchContentResult {
  title: string | null;
  content: string | null;
  success: boolean;
}

const MAX_CONTENT_LENGTH = 8000;
const FETCH_TIMEOUT_MS = 10000;

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchContent(url: string): Promise<FetchContentResult> {
  try {
    const response = await safeFetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return { title: null, content: null, success: false };
    }

    const html = await response.text();
    const { document } = parseHTML(html);

    // Try Readability first
    const reader = new Readability(document);
    const article = reader.parse();

    let title: string | null = null;
    let content: string | null = null;

    if (article && article.textContent && article.textContent.length >= 50) {
      title = article.title || null;
      content = article.textContent.slice(0, MAX_CONTENT_LENGTH);
    } else {
      // Fallback: strip HTML tags
      title = document.querySelector("title")?.textContent || null;
      const stripped = stripHtmlTags(html);
      content = stripped.length >= 50 ? stripped.slice(0, MAX_CONTENT_LENGTH) : null;
    }

    return {
      title,
      content,
      success: content !== null,
    };
  } catch (err) {
    // SSRF rejections are expected — log them at info so we don't pollute
    // error metrics when a user pastes localhost / a private IP. All other
    // errors (network, parse) get the existing silent-failure semantics.
    if (err instanceof SsrfBlockedError) {
      logger.info(
        { event: "fetch_content.ssrf_blocked", reason: err.message },
        "blocked unsafe URL fetch"
      );
    }
    return { title: null, content: null, success: false };
  }
}
