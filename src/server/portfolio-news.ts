import { DOMParser } from "linkedom";

export type PortfolioAssetType = "stock" | "crypto";

export interface PortfolioNewsSearchInput {
  symbol: string;
  name?: string | null;
  assetType?: PortfolioAssetType | null;
}

export interface PortfolioNewsArticle {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  snippet: string;
}

const GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss/search";
const MARKETAUX_NEWS_URL = "https://api.marketaux.com/v1/news/all";
const RECENT_NEWS_WINDOW_MS = 72 * 60 * 60 * 1000;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildAssetHints(assetType?: PortfolioAssetType | null) {
  if (assetType === "crypto") {
    return ["crypto", "token", "coin", "blockchain"];
  }

  return ["stock", "shares", "nasdaq", "nyse"];
}

export function buildPortfolioNewsSearchQueries({
  symbol,
  name,
  assetType,
}: PortfolioNewsSearchInput) {
  const normalizedSymbol = normalizeWhitespace(symbol).toUpperCase();
  const normalizedName = normalizeWhitespace(name ?? "");
  const hints = buildAssetHints(assetType);
  const queries = new Set<string>();

  const pushQuery = (parts: Array<string | null | undefined>) => {
    const query = normalizeWhitespace(parts.filter(Boolean).join(" "));
    if (query) {
      queries.add(query);
    }
  };

  if (normalizedName && normalizedName.toUpperCase() !== normalizedSymbol) {
    pushQuery([`"${normalizedName}"`, `"${normalizedSymbol}"`, hints[0], hints[1]]);
    pushQuery([`"${normalizedName}"`, hints[0], hints[1]]);
  }

  pushQuery([`"${normalizedSymbol}"`, hints[0], hints[1], hints[2], hints[3]]);

  return [...queries];
}

function extractTextContent(rawHtml: string) {
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  return normalizeWhitespace(doc.documentElement.textContent ?? "");
}

export function parseGoogleNewsRss(xml: string): PortfolioNewsArticle[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const items = Array.from(doc.querySelectorAll("item") as ArrayLike<Element>);
  const deduped = new Map<string, PortfolioNewsArticle>();

  for (const item of items) {
    const title = normalizeWhitespace(item.querySelector("title")?.textContent ?? "");
    const link = normalizeWhitespace(item.querySelector("link")?.textContent ?? "");
    const source = normalizeWhitespace(item.querySelector("source")?.textContent ?? "Google News");
    const pubDate = normalizeWhitespace(item.querySelector("pubDate")?.textContent ?? "");
    const description = item.querySelector("description")?.textContent ?? "";

    if (!title || !link || !pubDate) {
      continue;
    }

    const publishedAtDate = new Date(pubDate);
    if (Number.isNaN(publishedAtDate.getTime())) {
      continue;
    }

    const article: PortfolioNewsArticle = {
      title,
      link,
      source,
      publishedAt: publishedAtDate.toISOString(),
      snippet: extractTextContent(description),
    };

    deduped.set(`${title}::${link}`, article);
  }

  return [...deduped.values()].sort((left, right) => (
    right.publishedAt.localeCompare(left.publishedAt)
  ));
}

export function parseMarketauxArticles(payload: {
  data?: Array<{
    title?: string | null;
    url?: string | null;
    source?: string | null;
    published_at?: string | null;
    description?: string | null;
    snippet?: string | null;
  }>;
}): PortfolioNewsArticle[] {
  const deduped = new Map<string, PortfolioNewsArticle>();

  for (const item of payload.data ?? []) {
    const title = normalizeWhitespace(item.title ?? "");
    const link = normalizeWhitespace(item.url ?? "");
    const source = normalizeWhitespace(item.source ?? "Marketaux");
    const publishedAt = normalizeWhitespace(item.published_at ?? "");
    const snippet = normalizeWhitespace(item.description ?? item.snippet ?? "");

    if (!title || !link || !publishedAt) {
      continue;
    }

    const publishedAtDate = new Date(publishedAt);
    if (Number.isNaN(publishedAtDate.getTime())) {
      continue;
    }

    deduped.set(`${title}::${link}`, {
      title,
      link,
      source,
      publishedAt: publishedAtDate.toISOString(),
      snippet,
    });
  }

  return [...deduped.values()].sort((left, right) => (
    right.publishedAt.localeCompare(left.publishedAt)
  ));
}

async function fetchMarketauxArticles(
  input: PortfolioNewsSearchInput,
  fetchImpl: typeof fetch
) {
  const apiKey = process.env.MARKETAUX_API_KEY?.trim();
  if (!apiKey) {
    return [];
  }

  const url = new URL(MARKETAUX_NEWS_URL);
  url.searchParams.set("api_token", apiKey);
  url.searchParams.set("language", "en");
  url.searchParams.set("limit", "6");
  url.searchParams.set("sort", "published_desc");

  const normalizedSymbol = normalizeWhitespace(input.symbol).toUpperCase();
  if (normalizedSymbol) {
    url.searchParams.set("symbols", normalizedSymbol);
  }

  const normalizedName = normalizeWhitespace(input.name ?? "");
  if (normalizedName && normalizedName.toUpperCase() !== normalizedSymbol) {
    url.searchParams.set("search", `"${normalizedName}" OR "${normalizedSymbol}"`);
  } else {
    url.searchParams.set("search", `"${normalizedSymbol}"`);
  }

  const response = await fetchImpl(url.toString(), {
    headers: {
      Accept: "application/json",
    },
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    return [];
  }

  const payload = await response.json() as {
    data?: Array<{
      title?: string | null;
      url?: string | null;
      source?: string | null;
      published_at?: string | null;
      description?: string | null;
      snippet?: string | null;
    }>;
  };

  return parseMarketauxArticles(payload).slice(0, 6);
}

async function fetchGoogleNewsArticles(
  input: PortfolioNewsSearchInput,
  fetchImpl: typeof fetch
) {
  const now = Date.now();
  const recentArticles = new Map<string, PortfolioNewsArticle>();
  const fallbackArticles = new Map<string, PortfolioNewsArticle>();

  for (const query of buildPortfolioNewsSearchQueries(input)) {
    const url = new URL(GOOGLE_NEWS_RSS_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("hl", "en-US");
    url.searchParams.set("gl", "US");
    url.searchParams.set("ceid", "US:en");

    const response = await fetchImpl(url.toString(), {
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9,*/*;q=0.8",
      },
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      continue;
    }

    const xml = await response.text();
    const articles = parseGoogleNewsRss(xml);

    for (const article of articles) {
      const dedupeKey = `${article.title}::${article.link}`;
      fallbackArticles.set(dedupeKey, article);

      if (now - new Date(article.publishedAt).getTime() <= RECENT_NEWS_WINDOW_MS) {
        recentArticles.set(dedupeKey, article);
      }
    }

    if (recentArticles.size >= 6) {
      break;
    }
  }

  const articles = recentArticles.size > 0 ? recentArticles : fallbackArticles;
  return [...articles.values()].slice(0, 6);
}

export async function fetchRecentPortfolioNewsArticles(
  input: PortfolioNewsSearchInput,
  fetchImpl: typeof fetch = fetch
) {
  const marketauxArticles = await fetchMarketauxArticles(input, fetchImpl);
  if (marketauxArticles.length > 0) {
    return marketauxArticles;
  }

  return fetchGoogleNewsArticles(input, fetchImpl);
}
