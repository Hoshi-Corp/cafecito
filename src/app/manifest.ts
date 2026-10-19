import type { MetadataRoute } from "next";

// Lets a phone install the app to its home screen, which iPhones need before they allow web push.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cafecito",
    short_name: "Cafecito",
    description: "Find when your friends are free.",
    start_url: "/",
    display: "standalone",
    background_color: "#fff7ec",
    theme_color: "#c9e7f2",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
