import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://sindaneassetsolutions.co.za/sitemap.xml",
    host: "https://sindaneassetsolutions.co.za",
  };
}
