"use client";

import { RefreshCw } from "lucide-react";

// Ro'yxat yuklanmaganda ko'rsatiladigan karta: toast bir necha soniyada yo'qoladi va sahifa "jim" qolardi.
export default function AdminLoadError({
  message,
  onRetry,
  retrying
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <section className="adminEmpty card" role="alert">
      <div className="adminEmptyTitle">Ma’lumot yuklanmadi</div>
      <div className="adminEmptyText">{message}</div>
      <button className="btn btn-primary" type="button" onClick={onRetry} disabled={retrying}>
        <RefreshCw className="lucide" aria-hidden="true" /> {retrying ? "Urinilmoqda..." : "Qayta urinish"}
      </button>
    </section>
  );
}
