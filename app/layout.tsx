import type { Metadata } from "next";
import "./globals.css";
import InstallRegister from "./install-register";

export const metadata: Metadata = {
  metadataBase: new URL("https://tmm-asset-health.mandlenkosisindane43.chatgpt.site"),
  title: "TMM Asset Health | Sindane Asset Solutions",
  description: "TMM Asset Health by Sindane Asset Solutions — mine fleet reliability, breakdown prevention and machine health management.",
  icons: {
    icon: "/sindane-logo.png",
    shortcut: "/sindane-logo.png",
    apple: "/sindane-logo.png",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "TMM Asset Health | Sindane Asset Solutions",
    description: "Track. Prevent. Perform. Mine fleet reliability and breakdown-prevention management.",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "TMM Asset Health | Sindane Asset Solutions",
    description: "Track. Prevent. Perform. Mine fleet reliability and breakdown-prevention management.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <a
          href="/subscription"
          aria-label="Open payments and subscription"
          style={{
            position: "fixed",
            right: 18,
            bottom: 18,
            zIndex: 9999,
            background: "#172033",
            color: "#fff",
            textDecoration: "none",
            fontWeight: 800,
            fontFamily: "Arial, sans-serif",
            fontSize: 13,
            padding: "11px 15px",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,.18)",
          }}
        >
          Payments / Subscription
        </a>
        <InstallRegister/>
      </body>
    </html>
  );
}
