import type { Metadata } from "next";
import AuthPage from "./ui/auth-page";
import { siteDescription, siteName } from "@/lib/site";

export const metadata: Metadata = {
  title: "Avto test, road test va avto imtihon platformasi",
  description: siteDescription,
  alternates: {
    canonical: "/"
  },
  openGraph: {
    title: `${siteName} — avto test, biletlar va video darslar`,
    description: siteDescription,
    url: "/",
    siteName,
    type: "website",
    locale: "uz_UZ",
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
    title: `${siteName} — avto test, biletlar va video darslar`,
    description: siteDescription,
    images: ["/opengraph-image"]
  }
};

export default function Page() {
  return <AuthPage />;
}
