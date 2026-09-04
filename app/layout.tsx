import type { Metadata, Viewport } from "next";
import "./globals.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "نظام البحث عن الطلبة | مدرسة سعود بن عزان",
  description: "نظام مدرسي للبحث في قوائم الطلبة والصفوف والشعب.",
  applicationName: "نظام البحث عن الطلبة",
  robots: { index: false, follow: false, nocache: true },
  manifest: `${basePath}/manifest.webmanifest`,
  icons: {
    icon: `${basePath}/favicon.svg`,
    shortcut: `${basePath}/favicon.svg`,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f8f7" },
    { media: "(prefers-color-scheme: dark)", color: "#071715" },
  ],
};

const themeScript = `
  try {
    const saved = localStorage.getItem('student-search-theme');
    const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (_) {}
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
