// Server sahifalarda ishlatiladigan sof JSON-LD yordamchilari. Ilgari "use client" faylida
// turgani uchun /biletlar va /mavzular serverda 500 xato berardi.
import type { PublicQuestion } from "./server-api";

export function buildFaqJsonLd(questions: PublicQuestion[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.slice(0, 50).map((q) => ({
      "@type": "Question",
      name: q.text,
      acceptedAnswer: {
        "@type": "Answer",
        text: [q.options[q.correctIndex], q.explanation].filter(Boolean).join(" — ")
      }
    }))
  };
}

export function buildBreadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url
    }))
  };
}

export function buildItemListJsonLd(name: string, items: { name: string; url?: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      ...(item.url ? { url: item.url } : {})
    }))
  };
}
