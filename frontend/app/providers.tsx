"use client";

import type { ReactNode } from "react";
import { CookiesProvider } from "react-cookie";
import QueryProvider from "./query-provider";
import { AuthProvider } from "./auth-provider";
import ToasterClient from "./toaster-client";
import { SiteLanguageProvider } from "./site-language-provider";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <CookiesProvider>
      <SiteLanguageProvider>
        <QueryProvider>
          <AuthProvider>
            {children}
            <ToasterClient />
          </AuthProvider>
        </QueryProvider>
      </SiteLanguageProvider>
    </CookiesProvider>
  );
}
