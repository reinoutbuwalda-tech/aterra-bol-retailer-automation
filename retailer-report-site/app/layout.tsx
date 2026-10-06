import { ClerkProvider } from "@clerk/nextjs";
import "./styles.css";

export const metadata = { title: "Aterra Retailer Reports", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <ClerkProvider><html lang="nl"><body>{children}</body></html></ClerkProvider>;
}
