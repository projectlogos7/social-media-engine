import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Social Media Engine", description: "Structured, on-brand social images from your design systems." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
