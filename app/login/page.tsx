import { AuthForm } from "../auth/auth-form";
import { Wordmark } from "../components/wordmark";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; error?: string }>;
}) {
  const { redirectTo, error } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="text-center">
          <Wordmark tone="dark" size="lg" />
        </div>

        {error === "confirm" && (
          <p
            role="alert"
            className="rounded border border-flag-line bg-flag-soft px-3 py-2 text-sm text-flag"
          >
            인증 링크가 만료되었거나 유효하지 않습니다. 다시 시도해 주세요.
          </p>
        )}

        <AuthForm mode="signin" redirectTo={redirectTo ?? "/"} />
      </div>
    </div>
  );
}
