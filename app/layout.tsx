import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { ApplicationShell } from "@/components/application-shell";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "커머스라이프",
  description: "마켓 주문수집, 클레임, 문의, 연동을 한곳에서 관리하는 독립 주문관리 서비스입니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="overflow-x-hidden" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} overflow-x-hidden bg-background antialiased`}>
        <Providers>
          <ApplicationShell>{children}</ApplicationShell>
        </Providers>
      </body>
    </html>
  );
}
