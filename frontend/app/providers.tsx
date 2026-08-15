"use client";

import type { ReactNode } from "react";
import { CookiesProvider } from "react-cookie";
import QueryProvider from "./query-provider";
import { AuthProvider } from "./auth-provider";
import ToasterClient from "./toaster-client";
import { SiteLanguageProvider } from "./site-language-provider";
import ServiceWorkerRegistrar from "./service-worker-registrar";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <CookiesProvider>
      <SiteLanguageProvider>
        <QueryProvider>
          <AuthProvider>
            {children}
            <ToasterClient />
            <ServiceWorkerRegistrar />
          </AuthProvider>
        </QueryProvider>
      </SiteLanguageProvider>
    </CookiesProvider>
  );
}
