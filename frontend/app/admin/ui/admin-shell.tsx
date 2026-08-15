"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, Menu, UploadCloud } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { adminSections } from "../admin-sections";
import { useAuth } from "../../auth-provider";
import { jsonOrError } from "@/lib/api-authed";
import { broadcastQuerySync } from "../../query-provider";

export default function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { authFetch } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const publishMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/admin/content/publish", { method: "POST" });
      return jsonOrError(res);
    },
    onSuccess: (data: any) => {
      toast.success(`Kontent yangilandi (versiya ${data?.version ?? ""})`.trim());
      broadcastQuerySync({ type: "invalidate", queryKey: ["content-sync"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });
  const isActive = (href: string) => (href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("adminSidebarCollapsed");
      if (stored) setCollapsed(stored === "1");
    } catch {}
  }, []);

  function toggleSidebar() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("adminSidebarCollapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  return (
    <div className={`adminLayout ${collapsed ? "collapsed" : ""}`}>
      <aside className="adminSidebar">
        <div className="adminBrand" onClick={() => router.push("/app")} role="button" tabIndex={0}>
          <div className="adminBrandText">
            <div className="textLogo textLogoAdmin" aria-label="Topshirdi">
              <span className="textLogoRoad">Topshirdi</span>
            </div>
            <div className="adminBrandSub">Admin panel</div>
          </div>
        </div>

        <nav className="adminNav" aria-label="Admin sections">
          {adminSections.map((section) => {
            const href = section.key === "overview" ? "/admin" : `/admin/${section.key}`;
            const active = isActive(href);
            const Icon = section.icon;
            return (
              <Link key={section.key} href={href} className={`adminNavItem ${active ? "active" : ""}`}>
                <span className={`adminNavIcon icon-${section.key}`}>
                  <Icon className="lucide" aria-hidden="true" />
                </span>
                <span className="adminNavText">
                  <span className="adminNavTitle">{section.title}</span>
                </span>
              </Link>
            );
          })}
        </nav>

        <button className="adminBackBtn" type="button" onClick={() => router.push("/app")}>
          <ChevronLeft className="lucide" aria-hidden="true" /> Saytga qaytish
        </button>
      </aside>

      <div className="adminContent">
        <header className="adminTopbar">
          <button className="adminMenuBtn" type="button" aria-label="Menu" onClick={toggleSidebar}>
            <Menu className="lucide" aria-hidden="true" />
          </button>
          <div className="adminTopbarTitle">Boshqaruv</div>
          <button
            className="adminPublishBtn"
            type="button"
            disabled={publishMutation.isPending}
            onClick={() => publishMutation.mutate()}
            title="Savollarga kiritilgan o‘zgarishlarni foydalanuvchilarga chiqarish"
          >
            <UploadCloud className="lucide" aria-hidden="true" />
            {publishMutation.isPending ? "Yangilanmoqda..." : "Kontentni yangilash"}
          </button>
        </header>

        <main className="adminMain">{children}</main>
      </div>
    </div>
  );
}
