import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./auth/actions";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          일러스트 TEXT 오타 검증
        </span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {user?.email}
          </span>
          <form action={signOut}>
            <button
              type="submit"
              className="h-9 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              로그아웃
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          로그인되었습니다
        </h1>
        <p className="max-w-prose text-zinc-600 dark:text-zinc-400">
          일러스트 파일을 업로드하면 TEXT를 추출해 오탈자와, 과거 이력과
          표기가 다른 부분을 확인해 드립니다.
        </p>
        <Link
          href="/check"
          className="mt-2 inline-flex h-11 w-fit items-center rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          오타 검증 시작하기 →
        </Link>
      </main>
    </div>
  );
}
