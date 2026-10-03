import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cata Club",
    short_name: "Cata Club",
    description: "Club formativo de tenis de mesa en Loja, Ecuador.",
    start_url: "/",
    display: "browser",
    background_color: "#f7f7f7",
    theme_color: "#f7f7f7",
    icons: [
      { src: "/brand/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
