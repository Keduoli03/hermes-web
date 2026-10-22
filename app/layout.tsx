import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { PwaRegistration } from "@/components/PwaRegistration";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { HERMES_APP_NAME, HERMES_ICON_32, HERMES_ICON_192, HERMES_APPLE_ICON } from "@/lib/hermes-brand.mjs";
import "katex/dist/katex.min.css";
import "./globals.css";
import "./settings.css";
import "./sidebar.css";
import "./sidebar-menu.css";
import "./hermes.css";

const notoSansMono = localFont({
  src: "../public/fonts/NotoSansMono-variable.ttf",
  weight: "100 900",
  style: "normal",
  variable: "--font-noto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: HERMES_APP_NAME,
  description: "Hermes Agent workspace",
  applicationName: HERMES_APP_NAME,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: HERMES_ICON_32, sizes: "32x32", type: "image/png" },
      {
        url: HERMES_ICON_192,
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: HERMES_APPLE_ICON,
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: HERMES_APP_NAME,
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1a" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className={`${notoSansMono.variable} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_INIT_SCRIPT,
          }}
        />
      </head>
      <body translate="no" className="notranslate" suppressHydrationWarning>
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
