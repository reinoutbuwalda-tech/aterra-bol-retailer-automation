import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import "./close.css";
import "./identity.css";
import "./inventory.css";
import "./policy-approval.css";
import "./operations.css";
import "./revenue-period.css";
import "./pnl.css";
import "./auth.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://aterra-financial-control-room.vercel.app"),
  title: "Aterra Financial Control Room",
  description: "Evidence-backed financial operations for Aterra.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: { title: "Aterra Financial Control Room", description: "Evidence-backed financial operations for Aterra.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClerkProvider><html lang="en"><body>{children}</body></html></ClerkProvider>;
}
