"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp, type AuthState } from "./actions";

type Props = {
  mode: "signin" | "signup";
  redirectTo?: string;
};

const fieldClass =
  "h-11 w-full rounded border border-line-strong bg-white px-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15";

export function AuthForm({ mode, redirectTo = "/" }: Props) {
  const isSignUp = mode === "signup";
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    isSignUp ? signUp : signIn,
    {},
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-5 rounded border border-line bg-surface p-7 shadow-[0_1px_2px_rgba(26,29,35,0.04),0_8px_24px_-16px_rgba(26,29,35,0.25)]"
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-bold text-ink">
          {isSignUp ? "계정 만들기" : "로그인"}
        </h1>
        <p className="text-sm text-ink-muted">
          {isSignUp
            ? "@jeisys.com 이메일로만 가입할 수 있습니다."
            : "사내 계정으로 로그인해 주세요."}
        </p>
      </div>

      {!isSignUp && <input type="hidden" name="redirectTo" value={redirectTo} />}

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-muted">이메일</span>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="name@jeisys.com"
            className={fieldClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-muted">비밀번호</span>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={isSignUp ? 8 : undefined}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            className={fieldClass}
          />
        </label>
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded border border-flag-line bg-flag-soft px-3 py-2 text-sm text-flag"
        >
          {state.error}
        </p>
      )}
      {state.message && (
        <p
          role="status"
          className="rounded border border-pass-line bg-pass-soft px-3 py-2 text-sm text-pass"
        >
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded bg-brand-700 text-sm font-medium text-white transition-colors hover:bg-brand-800 disabled:opacity-60"
      >
        {pending ? "처리 중…" : isSignUp ? "가입하기" : "로그인"}
      </button>

      <p className="border-t border-line pt-4 text-center text-sm text-ink-muted">
        {isSignUp ? "이미 계정이 있으신가요? " : "계정이 없으신가요? "}
        <Link
          href={isSignUp ? "/login" : "/signup"}
          className="font-medium text-brand-700 underline underline-offset-4"
        >
          {isSignUp ? "로그인" : "가입하기"}
        </Link>
      </p>
    </form>
  );
}
