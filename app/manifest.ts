import type { MetadataRoute } from "next";
import { HERMES_APP_NAME, HERMES_ICON_192, HERMES_ICON_512 } from "../lib/hermes-brand.mjs";

export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  const appName = process.env.PI_WEB_APP_NAME?.trim() || HERMES_APP_NAME;
  return {
    id: "/",
    name: appName,
    short_name: appName,
    description: "Hermes Agent workspace",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1a1a1a",
    categories: ["developer", "productivity"],
    lang: "en",
    icons: [
      {
        src: HERMES_ICON_192,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: HERMES_ICON_512,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
