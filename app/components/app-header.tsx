import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../auth/actions";
import { Wordmark } from "./wordmark";

export async function AppHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="bg-brand-700">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-6">
        <Link href="/check" className="shrink-0">
          <Wordmark />
        </Link>

        <div className="flex items-center gap-4">
          <nav className="flex items-center gap-3 text-sm">
            <Link href="/check" className="text-brand-100 hover:text-white">
              파일 검증
            </Link>
            <Link href="/explorer" className="text-brand-100 hover:text-white">
              폴더 탐색
            </Link>
          </nav>
          <span className="hidden text-sm text-brand-100 sm:inline">
            {user?.email}
          </span>
          <form action={signOut}>
            <button
              type="submit"
              className="h-8 rounded border border-brand-500 px-3 text-sm text-brand-100 transition-colors hover:bg-brand-600 hover:text-white"
            >
              로그아웃
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
