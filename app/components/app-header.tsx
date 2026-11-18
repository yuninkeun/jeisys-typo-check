import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../auth/actions";
import { NavLink, ThemeButton } from "./side-client";

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
const BUILT_AT = process.env.NEXT_PUBLIC_BUILT_AT ?? "";

/** Jeisys UI 표준 사이드바: 브랜드 바 → 로고 → 앱 이름·테마 → 스탬프 → 메뉴. */
export async function AppHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <aside className="flex shrink-0 flex-col border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:w-[232px] md:border-r md:border-b-0">
      <div className="h-[3px] bg-[var(--brand,#1a3591)]" />
      <div className="flex flex-col gap-3 px-4 pt-4 pb-3">
        <Link href="/check" aria-label="Jeisys 오타 검증 처음으로" className="w-fit">
          <span className="jui-logo" role="img" aria-label="Jeisys" />
        </Link>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[15px] font-bold text-ink">오타 검증</span>
          <ThemeButton />
        </div>
        <div className="flex flex-col text-xs leading-5 text-ink-muted tabular-nums">
          <span>v{VERSION}</span>
          <span>데이터 기준일 검사한 시점</span>
          <span>최신화 {BUILT_AT}</span>
        </div>
      </div>

      <nav className="nav flex flex-row gap-1 border-t border-line px-2 py-3 md:flex-col">
        <NavLink href="/check" icon="verify">
          파일 검증
        </NavLink>
        <NavLink href="/explorer" icon="layers">
          폴더 탐색
        </NavLink>
      </nav>

      <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 md:mt-auto">
        <span className="truncate text-xs text-ink-muted" title={user?.email ?? ""}>
          {user?.email}
        </span>
        <form action={signOut}>
          <button
            type="submit"
            className="h-8 shrink-0 rounded border border-line-strong bg-surface px-3 text-xs text-ink hover:border-brand-700"
          >
            로그아웃
          </button>
        </form>
      </div>
    </aside>
  );
}
