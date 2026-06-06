import { ImageResponse } from "next/og";
import { siteDescription, siteName } from "@/lib/site";

export const runtime = "edge";
export const alt = siteName;
export const size = {
  width: 1200,
  height: 630
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px",
          color: "#ffffff",
          background:
            "radial-gradient(circle at top left, rgba(47,109,255,0.38), transparent 36%), linear-gradient(135deg, #050816 0%, #0a1021 50%, #050816 100%)"
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div
            style={{
              width: "120px",
              height: "8px",
              borderRadius: "999px",
              background: "linear-gradient(90deg, #2f6dff 0%, #22c55e 100%)"
            }}
          />
          <div style={{ fontSize: 72, fontWeight: 900, letterSpacing: "-0.05em", lineHeight: 1.05 }}>{siteName}</div>
          <div style={{ fontSize: 30, color: "rgba(255,255,255,0.82)", maxWidth: "900px", lineHeight: 1.35 }}>{siteDescription}</div>
        </div>

        <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", fontSize: 24, color: "rgba(255,255,255,0.82)" }}>
          <div style={{ padding: "12px 18px", borderRadius: "999px", background: "rgba(255,255,255,0.08)" }}>Mavzular</div>
          <div style={{ padding: "12px 18px", borderRadius: "999px", background: "rgba(255,255,255,0.08)" }}>Biletlar</div>
          <div style={{ padding: "12px 18px", borderRadius: "999px", background: "rgba(255,255,255,0.08)" }}>Imtihon rejimi</div>
        </div>
      </div>
    ),
    size
  );
}
