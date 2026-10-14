import type { MetadataRoute } from "next";

// Lets a phone install the app to its home screen, which iPhones need before they allow web push.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cafecito",
    short_name: "Cafecito",
    description: "Find when your friends are free.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [{ src: "/favicon.ico", sizes: "48x48", type: "image/x-icon" }],
  };
}
