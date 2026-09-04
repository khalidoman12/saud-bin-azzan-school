import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  return {
    name: "نظام البحث عن الطلبة — مدرسة سعود بن عزان",
    short_name: "بحث الطلبة",
    description: "نظام مدرسي للبحث في قوائم الطلبة والصفوف والشعب.",
    start_url: `${basePath}/`,
    display: "standalone",
    background_color: "#f2f8f7",
    theme_color: "#087f70",
    lang: "ar",
    dir: "rtl",
    icons: [
      { src: `${basePath}/favicon.svg`, sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
