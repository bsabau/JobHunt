"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

// `nonce` lets the inline theme script run under the page's CSP (see proxy.ts).
export function ThemeProvider({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="dark" forcedTheme="dark" enableSystem={false} nonce={nonce}>
      {children}
    </NextThemesProvider>
  );
}
