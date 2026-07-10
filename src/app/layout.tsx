import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Script from "next/script";
import CyberBackground from "@/components/CyberBackground";

const inter = Inter({ subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const viewport: Viewport = {
  themeColor: "#05070f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export const metadata: Metadata = {
  title: "Razoter - OpenAI API Proxy & Router",
  description: "Merge multiple OpenAI-compatible API endpoints into one with automatic rotation",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/icons/icon-192x192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/icon-512x512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icons/icon-192x192.png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Razoter",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className={`${inter.className} ${jetbrainsMono.variable} antialiased`}>
        <CyberBackground />
        <div className="carbon-layer" aria-hidden />
        <div className="hud-corner hud-tl" aria-hidden />
        <div className="hud-corner hud-br" aria-hidden />
        {children}
        <Script id="sw-register" strategy="afterInteractive">
          {`
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js').catch(() => {});
              });
            }
          `}
        </Script>
      </body>
    </html>
  );
}
