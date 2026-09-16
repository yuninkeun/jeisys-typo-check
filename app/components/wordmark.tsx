/** Mirrors the "Jeisys : CMS" lockup used across Jeisys internal tools. */
export function Wordmark({
  suffix = "오타 검증",
  tone = "light",
  size = "md",
}: {
  suffix?: string;
  tone?: "light" | "dark";
  size?: "md" | "lg";
}) {
  const isLight = tone === "light";
  return (
    <span className="inline-flex items-baseline gap-2 whitespace-nowrap">
      <span
        className={[
          "font-serif tracking-tight",
          size === "lg" ? "text-3xl" : "text-lg",
          isLight ? "text-white" : "text-brand-700",
        ].join(" ")}
      >
        Jeisys
      </span>
      <span
        className={
          isLight ? "text-sm text-brand-200" : "text-sm text-ink-faint"
        }
      >
        :
      </span>
      <span
        className={[
          "font-medium",
          size === "lg" ? "text-base" : "text-sm",
          isLight ? "text-brand-100" : "text-ink-muted",
        ].join(" ")}
      >
        {suffix}
      </span>
    </span>
  );
}
