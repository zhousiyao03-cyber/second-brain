import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Knosi",
    short_name: "Knosi",
    description: "A personal knowledge management workspace",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f5f4",
    theme_color: "#f5f5f4",
    icons: [
      {
        src: "/pwa-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/pwa-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
