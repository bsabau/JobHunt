import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { FeedbackProvider } from "@/components/feedback";
import { ThemeProvider } from "@/components/theme-provider";
import { TimezoneSync } from "@/components/timezone-sync";
import { Analytics } from "@vercel/analytics/next";
import { NONCE_HEADER } from "@/lib/csp";

export const metadata: Metadata = {
  title: "JobHunt Board",
  description: "Track job applications in a kanban board and Sankey pipeline"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Next puts the nonce on its own scripts; the theme script needs it passed.
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider nonce={nonce}>
          <FeedbackProvider>{children}</FeedbackProvider>
        </ThemeProvider>
        <TimezoneSync />
        <Analytics />
      </body>
    </html>
  );
}
