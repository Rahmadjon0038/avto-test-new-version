"use client";

import { useEffect, useState } from "react";

const APP_LINK = "topshirdi://open";
const IOS_STORE = "https://apps.apple.com/us/app/topshirdi/id6781198005";
const ANDROID_STORE = "https://play.google.com/store/apps/details?id=uz.roadtest.app&hl=en_IE";

const TEXT = {
  title: "Ilovaga qaytish",
  lead: "Ilova ochilmoqda. Kirish avtomatik bajariladi.",
  open: "Ilovani ochish",
  hint: "Ilova ochilmadimi? Uni telefoningizdan o‘zingiz oching. Kirish avtomatik bajariladi.",
  install: "Ilova o‘rnatilmagan bo‘lsa:"
};

export default function OpenAppClient() {
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    // Maxsus manzil (topshirdi://) orqali ilovani ochamiz; ilova o'rnatilmagan bo'lsa hech narsa bo'lmaydi.
    window.location.href = APP_LINK;
    const timer = window.setTimeout(() => setShowHint(true), 2000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 420, width: "100%", padding: 28, textAlign: "center", display: "grid", gap: 14 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>{TEXT.title}</h1>
        <p style={{ margin: 0, color: "var(--muted)" }}>{TEXT.lead}</p>
        <a className="btn btn-primary" href={APP_LINK}>
          {TEXT.open}
        </a>
        {showHint ? (
          <>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>{TEXT.hint}</p>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
              {TEXT.install}{" "}
              <a href={IOS_STORE} target="_blank" rel="noreferrer">
                App Store
              </a>{" "}
              ·{" "}
              <a href={ANDROID_STORE} target="_blank" rel="noreferrer">
                Google Play
              </a>
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}
