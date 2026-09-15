"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp, type AuthState } from "./actions";

type Props = {
  mode: "signin" | "signup";
  redirectTo?: string;
};

export function AuthForm({ mode, redirectTo = "/" }: Props) {
  const isSignUp = mode === "signup";
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    isSignUp ? signUp : signIn,
    {},
  );

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {isSignUp ? "계정 만들기" : "로그인"}
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {isSignUp
          ? "@jeisys.com 이메일로만 가입할 수 있습니다."
          : "사내 계정으로 로그인해 주세요."}
      </p>

      <form action={formAction} className="mt-8 flex flex-col gap-4">
        {!isSignUp && (
          <input type="hidden" name="redirectTo" value={redirectTo} />
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            이메일
          </span>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="name@jeisys.com"
            className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-300"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            비밀번호
          </span>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={isSignUp ? 8 : undefined}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-300"
          />
        </label>

        {state.error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300"
          >
            {state.error}
          </p>
        )}
        {state.message && (
          <p
            role="status"
            className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
          >
            {state.message}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 h-11 rounded-lg bg-zinc-900 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {pending ? "처리 중…" : isSignUp ? "가입하기" : "로그인"}
        </button>
      </form>

      <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
        {isSignUp ? "이미 계정이 있으신가요? " : "계정이 없으신가요? "}
        <Link
          href={isSignUp ? "/login" : "/signup"}
          className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-50"
        >
          {isSignUp ? "로그인" : "가입하기"}
        </Link>
      </p>
    </div>
  );
}
