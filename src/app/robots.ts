import type { MetadataRoute } from "next";

const SITE_URL = "https://www.knosi.xyz";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/share/"],
        disallow: [
          "/api/",
          "/oauth/",
          "/login",
          "/register",
          "/dashboard",
          "/notes",
          "/learn",
          "/projects",
          "/portfolio",
          "/focus",
          "/ask",
          "/bookmarks",
          "/explore",
          "/settings",
          "/workflows",
          "/usage",
          "/cli",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
