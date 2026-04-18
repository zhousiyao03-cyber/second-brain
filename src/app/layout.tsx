import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://www.knosi.xyz";
const SITE_TITLE = "Knosi — a self-hostable second brain for your AI conversations";
const SITE_DESCRIPTION =
  "Capture high-signal Claude and ChatGPT answers, turn them into structured notes, and ask AI on top of your own knowledge. Open source and self-hostable.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s · Knosi",
  },
  description: SITE_DESCRIPTION,
  applicationName: "Knosi",
  manifest: "/manifest.webmanifest",
  keywords: [
    "second brain",
    "knowledge management",
    "Claude",
    "ChatGPT",
    "AI notes",
    "personal knowledge base",
    "self-hosted",
    "open source",
    "RAG",
    "Notion alternative",
  ],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Knosi",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_US",
    images: [
      {
        url: "/knosi-logo.png",
        width: 512,
        height: 512,
        alt: "Knosi",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/knosi-logo.png"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Knosi",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full bg-[var(--background)] text-[var(--foreground)]">
        <Providers>{children}</Providers>
        <Script
          defer
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon='{"token": "77230078425f404aa623df2e0c39e471"}'
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
