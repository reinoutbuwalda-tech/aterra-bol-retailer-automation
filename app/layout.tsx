import type { Metadata } from "next";
import "./globals.css";
import "./close.css";
import "./identity.css";
import "./inventory.css";

export const metadata: Metadata = {
  title: "Aterra Financial Control Room",
  description: "Evidence-backed financial operations for Aterra.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: { title: "Aterra Financial Control Room", description: "Evidence-backed financial operations for Aterra.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
