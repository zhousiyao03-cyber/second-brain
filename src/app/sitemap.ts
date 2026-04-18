import type { MetadataRoute } from "next";
import { isNotNull } from "drizzle-orm";
import { db } from "@/server/db";
import { notes, osProjectNotes } from "@/server/db/schema";

const SITE_URL = "https://www.knosi.xyz";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];

  const shareEntries: MetadataRoute.Sitemap = [];

  try {
    const sharedNotes = await db
      .select({ token: notes.shareToken, updatedAt: notes.updatedAt })
      .from(notes)
      .where(isNotNull(notes.shareToken));
    for (const row of sharedNotes) {
      if (!row.token) continue;
      shareEntries.push({
        url: `${SITE_URL}/share/${row.token}`,
        lastModified: row.updatedAt ?? now,
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  } catch (err) {
    console.warn("[sitemap] failed to enumerate shared notes", err);
  }

  try {
    const sharedProjectNotes = await db
      .select({
        token: osProjectNotes.shareToken,
        updatedAt: osProjectNotes.updatedAt,
      })
      .from(osProjectNotes)
      .where(isNotNull(osProjectNotes.shareToken));
    for (const row of sharedProjectNotes) {
      if (!row.token) continue;
      shareEntries.push({
        url: `${SITE_URL}/share/project-note/${row.token}`,
        lastModified: row.updatedAt ?? now,
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  } catch (err) {
    console.warn("[sitemap] failed to enumerate shared project notes", err);
  }

  return [...staticEntries, ...shareEntries];
}
