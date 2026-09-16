import { AuthForm } from "../auth/auth-form";
import { Wordmark } from "../components/wordmark";

export default function SignUpPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="text-center">
          <Wordmark tone="dark" size="lg" />
        </div>
        <AuthForm mode="signup" />
      </div>
    </div>
  );
}
