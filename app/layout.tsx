import type { Metadata } from "next";
import { Lora, Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

// Stands in for the Palatino-style serif used in the Jeisys wordmark.
const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  weight: ["700"],
});

export const metadata: Metadata = {
  title: "Jeisys 오타 검증",
  description: "일러스트 파일의 TEXT 오탈자를 생산 전에 검증합니다.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${notoSansKr.variable} ${lora.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
