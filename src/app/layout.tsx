import type { Metadata, Viewport } from "next";
import { Google_Sans_Flex } from "next/font/google";
import "./globals.css";
import { SkyClock } from "@/components/SkyClock";
import { SKY_SCRIPT } from "@/lib/sky";

// Rounded corners (ROND) for headings, and optical sizes so the big day name and small labels both stay crisp.
const flex = Google_Sans_Flex({
  variable: "--font-flex",
  subsets: ["latin", "latin-ext"],
  axes: ["ROND", "opsz"],
  // Next.js has no metrics for this family to size a fallback with.
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Cafecito",
  description: "See when your friends are free",
  icons: { apple: "/apple-touch-icon.png" }, // the Home Screen icon on iPhones, which push needs
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#c9e7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#1d3550" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The script sets data-sky (dawn, day, dusk or night) from the viewer's clock before the first paint.
    <html lang="en" className={`${flex.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SKY_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <SkyClock />
        {children}
      </body>
    </html>
  );
}
