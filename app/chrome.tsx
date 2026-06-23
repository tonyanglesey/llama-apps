"use client";

import { useCallback, useEffect, useState } from "react";
import { LlamaHeader, LlamaFooter } from "@lla-ma/ui";

type Theme = "dark" | "light";

// The shared lla.ma shell, wrapped around every console page. This is the OSS
// console: ungated (run it privately — loopback / your own reverse proxy / VPN),
// in contrast to the hosted edition which gates it behind an account.
//
// Theme lives here so the @lla-ma/ui header's toggle can drive it. The no-flash
// script in layout.tsx has already set <html data-theme=…> from localStorage
// before paint; we read it back on mount. The `data-theme` attribute drives both
// @lla-ma/ui's tokens and our Tailwind `dark:` variant (see globals.css).
export default function AppChrome({
  children,
}: {
  children: React.ReactNode;
}) {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const t = document.documentElement.getAttribute("data-theme");
    if (t === "light" || t === "dark") setTheme(t);
  }, []);
  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("theme", next);
      } catch {
        /* private mode / storage disabled — fine, just don't persist */
      }
      return next;
    });
  }, []);

  return (
    <>
      <LlamaHeader
        app="apps"
        theme={theme}
        onToggleTheme={toggleTheme}
        maxWidth="100%"
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {children}
      </main>

      <LlamaFooter
        theme={theme}
        maxWidth="100%"
        tagline="The self-hosted, push-to-deploy app platform — your own Vercel, on your own box."
        copyright="lla.ma · © 2026 Via Ventures"
        columns={[
          {
            title: "PROJECT",
            links: [
              {
                label: "GitHub",
                href: "https://github.com/tonyanglesey/llama-apps",
              },
              { label: "lla.ma", href: "https://lla.ma" },
            ],
          },
          {
            // TODO: wire real destinations — these are placeholders for now.
            title: "DEVELOPERS",
            links: [
              { label: "Docs", href: "https://lla.ma/docs" },
              { label: "lla.ma base", href: "https://github.com/tonyanglesey/llama-base" },
            ],
          },
        ]}
      />
    </>
  );
}
