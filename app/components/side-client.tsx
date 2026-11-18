"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** 사이드바 메뉴 한 줄: 표준 선 아이콘(data-icon) + 이름. 선택된 메뉴는 아이콘·글자 모두 강조색. */
export function NavLink({ href, icon, children }: { href: string; icon: string; children: React.ReactNode }) {
  const path = usePathname();
  const on = path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      data-icon={icon}
      aria-current={on ? "page" : undefined}
      className={`flex h-9 items-center gap-2 rounded px-3 text-[13px] ${
        on ? "bg-brand-50 font-semibold text-brand-700" : "text-[var(--nav-txt,#4a5873)] hover:bg-canvas"
      }`}
    >
      <span className="ic" aria-hidden />
      {children}
    </Link>
  );
}

type Theme = "light" | "dark";

/** ☾ / ☀ — 라이트가 기본, 고른 테마는 이 브라우저에만 기억한다(localStorage.ui_theme). */
export function ThemeButton() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    void Promise.resolve().then(() =>
      setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
    );
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("ui_theme", next);
    } catch {
      // 개인 창: 이번 방문에만 적용된다.
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === "dark" ? "라이트 화면으로" : "다크 화면으로"}
      aria-label={theme === "dark" ? "라이트 화면으로 바꾸기" : "다크 화면으로 바꾸기"}
      className="flex h-7 w-7 items-center justify-center rounded-sm border border-line text-sm text-ink-muted hover:border-brand-700 hover:text-ink"
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
