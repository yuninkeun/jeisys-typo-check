import { AuthForm } from "../auth/auth-form";

export default function SignUpPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <AuthForm mode="signup" />
    </div>
  );
}
