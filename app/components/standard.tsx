/** Jeisys UI 표준 화면 뼈대 부품: 데이터 배지 · 기준 배지 · 결론 줄 (가이드 «KPI 카드 · 패널 · 기준 배지 · 결론 줄»). */

/** 표준 날짜·시각 표기: YYYY-MM-DD HH:mm (한국 시각). */
export function stamp(d: Date | string = new Date()) {
  const t = new Date(typeof d === "string" ? d : d.getTime());
  return new Date(t.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

/** 화면 제목 오른쪽: 실데이터인지 샘플인지 언제나 밝힌다. */
export function DataBadge({ sample = false }: { sample?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold ${
        sample ? "bg-warn-soft text-warn" : "bg-[var(--info-bg,rgba(37,99,235,.1))] text-[var(--info,#2563eb)]"
      }`}
    >
      {sample ? "샘플" : "실데이터"}
    </span>
  );
}

export type BasisRow = {
  /** 무엇의 숫자·결과인가 */
  fact: string;
  /** 어디서 왔나 */
  src: string;
  /** 조회 조건 */
  cond: string;
  /** 기준 시각 */
  asof: string;
  tag: "정본" | "기준 확인 필요";
};

/** 기준 배지 — 화면 제목 바로 아래. 사실 : 소스 · 조건 · 기준 시각 · [정본 | 기준 확인 필요]. */
export function Basis({ rows }: { rows: BasisRow[] }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-ink-muted">
      {rows.map((r) => (
        <div key={r.fact}>
          <b className="font-semibold text-ink">{r.fact}</b> : {r.src} · {r.cond} · {r.asof} ·{" "}
          <span className={`font-semibold ${r.tag === "정본" ? "text-pass" : "text-warn"}`}>[{r.tag}]</span>
        </div>
      ))}
    </div>
  );
}

/** 결론 줄 — 화면 맨 아래. 숫자가 말하는 행동 한 가지. */
export function Conclusion({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-r-md border-l-[3px] border-brand-700 bg-brand-50 px-4 py-3 text-[13px] text-ink">
      <b className="font-semibold">결국 뭐 하자:</b> {children}
    </p>
  );
}
