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
          다음 단계는 일러스트 파일 업로드와 TEXT 오타 검증 기능입니다. 이 페이지는
          로그인한 사용자에게만 보입니다.
        </p>
      </main>
    </div>
  );
}
