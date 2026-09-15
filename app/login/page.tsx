import { AuthForm } from "../auth/auth-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; error?: string }>;
}) {
  const { redirectTo, error } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-sm flex-col gap-4">
        {error === "confirm" && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300"
          >
            인증 링크가 만료되었거나 유효하지 않습니다. 다시 시도해 주세요.
          </p>
        )}
        <AuthForm mode="signin" redirectTo={redirectTo ?? "/"} />
      </div>
    </div>
  );
}
