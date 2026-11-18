/** Jeisys UI 표준 로고(표준 파일의 --logo) + 앱 이름. 로그인·가입 화면 머리에 쓴다. */
export function Wordmark({ suffix = "오타 검증" }: { suffix?: string; tone?: "light" | "dark"; size?: "md" | "lg" }) {
  return (
    <span className="inline-flex flex-col items-center gap-2">
      <span className="jui-logo h-[28px]! w-[73px]!" role="img" aria-label="Jeisys" />
      <span className="text-[22px] font-bold text-ink">{suffix}</span>
    </span>
  );
}
