import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "ROOMS — Управление гостиницей",
  description: "Бронирования, гости и номера",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
