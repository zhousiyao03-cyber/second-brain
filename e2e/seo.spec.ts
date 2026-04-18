import { test, expect } from "@playwright/test";

test.describe("SEO primitives", () => {
  test("/robots.txt is served with allow/disallow rules and sitemap", async ({
    request,
  }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/User-Agent:\s*\*/i);
    expect(body).toMatch(/Allow:\s*\/share\/?/);
    expect(body).toMatch(/Disallow:\s*\/api\/?/);
    expect(body).toMatch(/Disallow:\s*\/settings/);
    expect(body).toMatch(/Sitemap:\s*https:\/\/www\.knosi\.xyz\/sitemap\.xml/);
  });

  test("/sitemap.xml lists the landing page", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("<urlset");
    expect(body).toContain("https://www.knosi.xyz/");
  });

  test("root layout exposes lang=en and rich OG metadata", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    const ogTitle = await page
      .locator('meta[property="og:title"]')
      .getAttribute("content");
    expect(ogTitle).toMatch(/Knosi/);

    const ogDescription = await page
      .locator('meta[property="og:description"]')
      .getAttribute("content");
    expect(ogDescription).toBeTruthy();
    expect(ogDescription!.length).toBeGreaterThan(40);

    const twitterCard = await page
      .locator('meta[name="twitter:card"]')
      .getAttribute("content");
    expect(twitterCard).toBe("summary_large_image");

    const canonical = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");
    expect(canonical).toBe("https://www.knosi.xyz/");
  });
});
