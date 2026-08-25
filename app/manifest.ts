import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TMM Asset Health by Sindane Asset Solutions",
    short_name: "TMM Health",
    description: "Machine production, reliability and breakdown-prevention management by Sindane Asset Solutions.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f6f3",
    theme_color: "#0d6b5d",
    icons: [{ src: "/sindane-logo.png", sizes: "1536x1536", type: "image/png" }],
  };
}
