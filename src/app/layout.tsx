import type { Metadata, Viewport } from "next";
import { Inter, Lora } from "next/font/google";
import "./globals.css";
import { VersionCheck } from "@/components/VersionCheck";

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
        {/* Preload the first hero video so the browser fetches it during HTML parse,
            BEFORE React hydrates. This eliminates the "load twice to fix distortion"
            issue: by the time AnimatedJesus mounts, the video is already in cache and
            decodes fast enough that videoWidth is non-zero before reveal. */}
        <link rel="preload" as="video" href="/jaisus-embraces.mp4" type="video/mp4" />
        <link rel="preload" as="video" href="/jaisus-prays.mp4" type="video/mp4" />
        {/* Defense-in-depth meta cache controls — some iOS Safari versions
            respect these even when HTTP headers are ignored by the PWA shell. */}
        <meta httpEquiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
      </head>
      <body className="min-h-full flex flex-col font-sans bg-stone-50">
        <VersionCheck buildId={BUILD_ID} />
        {children}
      </body>
    </html>
  );
}
