import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";
import { fetchPublicTickets, fetchPublicTopics } from "@/lib/server-api";

export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const url = (path: string) => new URL(path, siteUrl).toString();
  const now = new Date();

  const [tickets, topics] = await Promise.all([fetchPublicTickets(), fetchPublicTopics()]);

  const ticketEntries: MetadataRoute.Sitemap = tickets
    .filter((t) => t.free)
    .map((t) => ({
      url: url(`/biletlar/${t.id}`),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8
    }));

  const topicEntries: MetadataRoute.Sitemap = topics
    .filter((t) => t.free)
    .map((t) => ({
      url: url(`/mavzular/${t.id}`),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8
    }));

  return [
    { url: url("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: url("/biletlar"), lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: url("/mavzular"), lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    ...ticketEntries,
    ...topicEntries,
    { url: url("/privacy"), lastModified: now, changeFrequency: "yearly", priority: 0.4 }
  ];
}
