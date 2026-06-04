"use client";

import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAdminSection } from "../admin-sections";

export default function AdminSectionPage() {
  const router = useRouter();
  const params = useParams<{ section: string }>();
  const sectionKey = String(params.section || "");
  const section = getAdminSection(sectionKey);
  const title = section?.title || "Bo‘lim";

  return (
    <section className="adminSectionPage">
      <div className="adminSectionHeader">
        <button className="btn btn-ghost" type="button" onClick={() => router.push("/admin")}>
          <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
        </button>
      </div>

      <div className="adminEmpty card">
        <div className="adminEmptyTitle">{title}</div>
      </div>
    </section>
  );
}
