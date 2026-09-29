import type { Metadata } from "next";
import "./globals.css";
import { FeedbackProvider } from "@/components/feedback";
import { ThemeProvider } from "@/components/theme-provider";
import { TimezoneSync } from "@/components/timezone-sync";
import { Analytics } from "@vercel/analytics/next";

export const metadata: Metadata = {
  title: "JobHunt Board",
  description: "Track job applications in a kanban board and Sankey pipeline"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <FeedbackProvider>{children}</FeedbackProvider>
        </ThemeProvider>
        <TimezoneSync />
        <Analytics />
      </body>
    </html>
  );
}
