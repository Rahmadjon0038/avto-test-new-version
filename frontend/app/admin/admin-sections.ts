import { BarChart3, Ticket, Users, LayoutGrid, Shield, FileText, SlidersHorizontal } from "lucide-react";

export type AdminSection = {
  key: string;
  title: string;
  icon: any;
};

export const adminSections: AdminSection[] = [
  {
    key: "overview",
    title: "Boshqaruv paneli",
    icon: BarChart3
  },
  {
    key: "users",
    title: "Foydalanuvchilar",
    icon: Users
  },
  {
    key: "topics",
    title: "Mavzular",
    icon: LayoutGrid
  },
  {
    key: "custom",
    title: "Sozlamali testlar",
    icon: SlidersHorizontal
  },
  {
    key: "questions",
    title: "Savollar",
    icon: FileText
  },
  {
    key: "tickets",
    title: "Biletlar",
    icon: Ticket
  },
  {
    key: "subscriptions",
    title: "Obunalar",
    icon: Shield
  },
];

export function getAdminSection(key: string) {
  return adminSections.find((section) => section.key === key) || null;
}
