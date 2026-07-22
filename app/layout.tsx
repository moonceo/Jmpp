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
  title: "소싱라이프 주문관리",
  description: "주문수집, 클레임, 문의, 마켓연동을 관리하는 업무 화면입니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="overflow-x-hidden" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} overflow-x-hidden bg-white antialiased`}>
        <Providers>
          <ApplicationShell>{children}</ApplicationShell>
        </Providers>
      </body>
    </html>
  );
}
