import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppChrome from "./chrome";
import LlamaBgGradient from "./ui/llama-bg-gradient";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "lla.ma Apps",
  description: "Self-hosted deploy console — your own Vercel.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // Dark is the default; the no-flash script below upgrades it to the saved
    // choice before paint. Theme is driven by the `data-theme` attribute that
    // @lla-ma/ui's tokens — and our Tailwind dark variant (globals.css) — key off.
    <html
      lang="en"
      data-theme="dark"
      // The no-flash script below mutates data-theme before hydration; that's an
      // intentional client/server divergence, so suppress the hydration warning
      // for this element (only the attribute it sets is affected).
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-100">
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}",
          }}
        />
        <LlamaBgGradient />
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
