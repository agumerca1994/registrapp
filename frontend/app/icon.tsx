import { ImageResponse } from "next/og";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        background: "#3b82f6",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "38px",
      }}
    >
      <span style={{ color: "white", fontSize: 108, fontWeight: 700, lineHeight: 1 }}>
        R
      </span>
    </div>,
    size
  );
}
