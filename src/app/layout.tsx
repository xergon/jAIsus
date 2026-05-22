import type { Metadata, Viewport } from "next";
import { Inter, Lora } from "next/font/google";
import "./globals.css";
import { VersionCheck } from "@/components/VersionCheck";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastProvider } from "@/components/Toast";
import { AnalyticsInit } from "@/components/AnalyticsInit";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

// Build ID baked in at build time. Compared against /api/version at runtime to
// detect when a new deploy is live and force-reload stale iOS PWAs.
//
// On Vercel: uses VERCEL_GIT_COMMIT_SHA (deterministic per deploy).
// Locally / non-Vercel: 'dev' sentinel. VersionCheck short-circuits when buildId
// is 'dev' so we don't infinite-loop reload in local development (which would
// happen if we used Date.now() — different value each module load = perpetual
// mismatch with /api/version, which also falls back to 'dev').
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || 'dev';

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "jAIsus — AI Spiritual Companion",
  description: "A compassionate AI guide grounded in biblical teachings, parables, and spiritual wisdom.",
  manifest: "/manifest.json",
  // Audit fix: explicit icons set so iOS Safari "Add to Home Screen" outside
  // the PWA install flow picks up the apple-touch-icon. Manifest icons cover
  // the PWA install path, but the &lt;link rel="apple-touch-icon"&gt; is read
  // separately by iOS for normal Safari bookmarks / home-screen shortcuts.
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-512.png',
    shortcut: '/icon-192.png',
  },
  // Search-engine policy — public pages crawlable, /api/* blocked via robots.ts.
  robots: { index: true, follow: true },
  // Social-media unfurls. /api/og is an edge-runtime dynamic OG image (1200x630
  // PNG via next/og, aggressively cached). Crawlers don't execute JS — they
  // need these meta tags in the initial HTML to discover the preview card.
  openGraph: {
    title: 'jAIsus — AI Spiritual Companion',
    description: 'A compassionate AI guide grounded in biblical teachings.',
    type: 'website',
    images: [
      // Audit fix: a static 512 PNG fallback after the dynamic OG image so a
      // crawler that hits /api/og while rate-limited still gets a card.
      { url: '/api/og?type=default', width: 1200, height: 630, alt: 'jAIsus' },
      { url: '/icon-512.png', width: 512, height: 512, alt: 'jAIsus' },
    ],
    siteName: 'jAIsus',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'jAIsus — AI Spiritual Companion',
    description: 'A compassionate AI guide grounded in biblical teachings.',
    images: ['/api/og?type=default'],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale — disabling user zoom violates WCAG 1.4.4 (Resize Text).
  // Users on small screens, low vision, or with accessibility needs must be able to zoom.
  themeColor: "#0d9488",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${lora.variable} h-full antialiased`}>
      <head>
        {/* Preload only the FIRST hero video so the browser fetches it during
            HTML parse, BEFORE React hydrates. Audit fix: was preloading both
            videos, which front-ran the LCP fetch with two MP4s; the second
            file isn't needed until the user is in 'speaking' state and the
            browser will fetch it on demand fast enough. */}
        <link rel="preload" as="video" href="/jaisus-embraces.mp4" type="video/mp4" />
        <link rel="prefetch" as="video" href="/jaisus-prays.mp4" type="video/mp4" />
        {/* Audit fix: removed dead `<meta http-equiv="Cache-Control" ...>` and
            its Pragma/Expires siblings. The HTML spec doesn't honor those
            http-equiv tags for caching — only Content-Type, default-style,
            and x-ua-compatible / refresh are honored. The real `no-store`
            directive now lives in next.config.ts's headers() block. */}
      </head>
      <body className="min-h-full flex flex-col font-sans bg-stone-50">
        {/* VersionCheck stays OUTSIDE the boundary so a render crash inside
            the app tree doesn't also kill the auto-reload-on-new-deploy path. */}
        <VersionCheck buildId={BUILD_ID} />
        <AnalyticsInit />
        <ServiceWorkerRegistration />
        <ToastProvider />
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
