import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "./driver-theme.css";

export const metadata: Metadata = {
  title: "GreenPath Logistics",
  description: "Agricultural delivery operations workspace",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
