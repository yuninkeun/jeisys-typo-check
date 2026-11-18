import type { Metadata } from "next";
import "./globals.css";

/** Jeisys UI 표준 서버. 복사하지 않고 연결해야 표준이 바뀔 때 같이 따라온다. */
const JUI = "https://zealous-cliff-0e4d81210.7.azurestaticapps.net/v1";

// 라이트가 기본, 다크는 사이드바 버튼으로 고른 사람만. 첫 화면이 깜빡이지 않게 <head> 에서 정한다.
const THEME_SCRIPT = `try{document.documentElement.dataset.theme=localStorage.getItem("ui_theme")==="dark"?"dark":"light"}catch(e){}`;

export const metadata: Metadata = {
  title: "Jeisys 오타 검증",
  description: "일러스트 파일의 TEXT 오탈자를 생산 전에 검증합니다.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" data-theme="light" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="stylesheet" href={`${JUI}/jui-palette.css`} />
        <link rel="stylesheet" href={`${JUI}/jui-common.css`} />
        <script src={`${JUI}/jui-common.js`} defer />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
