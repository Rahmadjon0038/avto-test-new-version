"use client";

import type { ReactNode } from "react";
import { CookiesProvider } from "react-cookie";
import QueryProvider from "./query-provider";
import { AuthProvider } from "./auth-provider";
import ToasterClient from "./toaster-client";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <CookiesProvider>
      <QueryProvider>
        <AuthProvider>
          {children}
          <ToasterClient />
        </AuthProvider>
      </QueryProvider>
    </CookiesProvider>
  );
}
