import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import Providers from "./providers";
import { getSiteUrl, siteDescription, siteKeywords, siteName } from "@/lib/site";

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: siteName,
    template: `%s | ${siteName}`
  },
  description: siteDescription,
  keywords: siteKeywords,
  applicationName: siteName,
  alternates: {
    canonical: "/"
  },
  openGraph: {
    type: "website",
    locale: "uz_UZ",
    url: "/",
    siteName,
    title: siteName,
    description: siteDescription,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: siteName
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: siteName,
    description: siteDescription,
    images: ["/opengraph-image"]
  },
  category: "education",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1
    }
  }
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: siteName,
  alternateName: ["Avto Test", "Road Test", "Avto Imtihon"],
  url: siteUrl.toString(),
  description: siteDescription,
  inLanguage: "uz"
};

const webApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: siteName,
  alternateName: ["Avto Test", "Road Test", "Avto Imtihon"],
  url: siteUrl.toString(),
  applicationCategory: "EducationalApplication",
  operatingSystem: "Web",
  description: siteDescription,
  inLanguage: "uz",
  isAccessibleForFree: true,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "UZS"
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uz">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webApplicationJsonLd) }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
