import { BarChart3, Users, LayoutGrid, Shield, Video } from "lucide-react";

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
    key: "videos",
    title: "Video darslar",
    icon: Video
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
