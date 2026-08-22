import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

const thai = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-thai",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ShelfEye — ตรวจชั้นวางด้วย AI",
  description:
    "ระบบตรวจจับช่องว่างบนชั้นวางและแจ้งเติมสินค้า สำหรับพนักงานภาคสนามและผู้จัดการพื้นที่",
};

export const viewport: Viewport = {
  themeColor: "#101828",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" className={thai.variable}>
      <body>{children}</body>
    </html>
  );
}
