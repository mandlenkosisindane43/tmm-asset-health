import type { Metadata } from "next";
import "./globals.css";
import InstallRegister from "./install-register";

export const metadata: Metadata = {
  metadataBase: new URL("https://sindaneassetsolutions.co.za"),
  title: "Sindane Asset Solutions | Mining Engineering & Digital Solutions",
  description: "Sindane Asset Solutions develops practical engineering and digital solutions that help mining operations track equipment, prevent avoidable downtime and improve performance.",
  keywords: ["Sindane Asset Solutions", "mining engineering solutions", "TMM Asset Health", "mining asset management", "maintenance management", "mining technology", "South Africa"],
  icons: { icon: "/sindane-logo.png", shortcut: "/sindane-logo.png", apple: "/sindane-logo.png" },
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Sindane Asset Solutions | Track. Prevent. Perform.",
    description: "Engineering and digital solutions for better mining performance.",
    url: "https://sindaneassetsolutions.co.za",
    siteName: "Sindane Asset Solutions",
    type: "website",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sindane Asset Solutions | Track. Prevent. Perform.",
    description: "Engineering and digital solutions for better mining performance.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Sindane Asset Solutions",
    url: "https://sindaneassetsolutions.co.za",
    logo: "https://sindaneassetsolutions.co.za/sindane-logo.png",
    slogan: "Track. Prevent. Perform.",
    founder: { "@type": "Person", name: "Mandlenkosi Elton Sindane", jobTitle: "Founder & CEO" },
    description: "Engineering and digital solutions focused on mining equipment performance, maintenance, operational visibility and practical problem-solving.",
  };

  return (
    <html lang="en">
      <body className="antialiased">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }} />
        {children}
        <InstallRegister />
      </body>
    </html>
  );
}
