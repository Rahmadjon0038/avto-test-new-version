import type { Metadata } from "next";
import OpenAppClient from "./open-app-client";

// Telegram botdagi "Ilovaga qaytish" tugmasi shu sahifaga olib keladi; sahifa mobil ilovani ochadi.
export const metadata: Metadata = {
  title: "Ilovani ochish | Topshirdi",
  robots: { index: false, follow: false }
};

export default function OpenAppPage() {
  return <OpenAppClient />;
}
