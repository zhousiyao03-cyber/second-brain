import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPortfolioNewsSearchQueries,
  fetchRecentPortfolioNewsArticles,
  parseMarketauxArticles,
  parseGoogleNewsRss,
} from "./portfolio-news.ts";

test("buildPortfolioNewsSearchQueries uses holding name to disambiguate ambiguous stock symbols", () => {
  const queries = buildPortfolioNewsSearchQueries({
    symbol: "JD",
    name: "京东",
    assetType: "stock",
  });

  assert.ok(queries.length > 0);
  assert.match(queries[0], /JD/);
  assert.match(queries[0], /京东/);
  assert.match(queries[0], /stock|shares|nasdaq|nyse/i);
});

test("buildPortfolioNewsSearchQueries adds crypto hints for tokens", () => {
  const queries = buildPortfolioNewsSearchQueries({
    symbol: "BTC",
    name: "Bitcoin",
    assetType: "crypto",
  });

  assert.ok(queries.some((query) => /crypto|token|coin|blockchain/i.test(query)));
  assert.ok(queries.some((query) => /Bitcoin/i.test(query)));
});

test("parseGoogleNewsRss extracts article title, source, link, and published time", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0">
    <channel>
      <item>
        <title>JD.com launches new same-day delivery program</title>
        <link>https://news.google.com/rss/articles/CBMiQ2h0dHBzOi8vZXhhbXBsZS5jb20vamQtbmV3cy1kZWxpdmVyeS1wcm9ncmFt0gEA</link>
        <pubDate>Tue, 01 Apr 2026 10:30:00 GMT</pubDate>
        <source url="https://example.com">Reuters</source>
        <description><![CDATA[<div>JD.com expanded delivery coverage in key cities.</div>]]></description>
      </item>
    </channel>
  </rss>`;

  const articles = parseGoogleNewsRss(xml);

  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, "JD.com launches new same-day delivery program");
  assert.equal(articles[0].source, "Reuters");
  assert.equal(
    articles[0].link,
    "https://news.google.com/rss/articles/CBMiQ2h0dHBzOi8vZXhhbXBsZS5jb20vamQtbmV3cy1kZWxpdmVyeS1wcm9ncmFt0gEA"
  );
  assert.equal(articles[0].publishedAt, "2026-04-01T10:30:00.000Z");
  assert.match(articles[0].snippet, /expanded delivery coverage/i);
});

test("parseMarketauxArticles normalizes Marketaux responses", () => {
  const articles = parseMarketauxArticles({
    data: [
      {
        uuid: "1",
        title: "JD.com expands logistics coverage",
        url: "https://example.com/jd-logistics",
        source: "Reuters",
        published_at: "2026-04-01T09:30:00.000Z",
        description: "JD.com announced a new round of same-day delivery expansion.",
      },
    ],
  });

  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, "JD.com expands logistics coverage");
  assert.equal(articles[0].link, "https://example.com/jd-logistics");
  assert.equal(articles[0].source, "Reuters");
  assert.equal(articles[0].publishedAt, "2026-04-01T09:30:00.000Z");
  assert.match(articles[0].snippet, /same-day delivery expansion/i);
});

test("fetchRecentPortfolioNewsArticles prefers Marketaux when api key exists", async () => {
  const originalApiKey = process.env.MARKETAUX_API_KEY;
  process.env.MARKETAUX_API_KEY = "test-marketaux-key";

  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({
      data: [
        {
          uuid: "1",
          title: "JD.com beats delivery expectations",
          url: "https://example.com/jd-news",
          source: "Bloomberg",
          published_at: "2026-04-01T08:00:00.000Z",
          description: "JD.com reported stronger than expected delivery performance.",
        },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const articles = await fetchRecentPortfolioNewsArticles({
      symbol: "JD",
      name: "京东",
      assetType: "stock",
    }, fetchImpl);

    assert.equal(articles.length, 1);
    assert.match(calls[0], /api\.marketaux\.com/);
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.MARKETAUX_API_KEY;
    } else {
      process.env.MARKETAUX_API_KEY = originalApiKey;
    }
  }
});
