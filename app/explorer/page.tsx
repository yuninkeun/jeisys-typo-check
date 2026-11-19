import { AppHeader } from "../components/app-header";
import { Explorer } from "./explorer";
import { Basis, DataBadge } from "../components/standard";

export const metadata = { title: "폴더 탐색 · Jeisys 오타 검증" };

export default function ExplorerPage() {
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <AppHeader />
      <main className="flex w-full max-w-[1440px] min-w-0 flex-1 flex-col gap-4 px-4 py-6 md:px-8">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-bold leading-tight text-ink">폴더 탐색</h1>
            <DataBadge />
          </div>
          <p className="text-sm text-ink-muted">
            검수 담당이 묻는 질문 — 이 폴더의 박스·스티커·멸균지 파일 중 오타 의심이 남은 것은 무엇이고, 누가 어떻게 결정했나
          </p>
        </div>
        <Basis
          rows={[
            {
              fact: "파일 목록",
              src: "이 PC에서 연 폴더",
              cond: "브라우저에서만 읽고, 검사할 파일만 서버로 보냄",
              asof: "폴더를 연 시점",
              tag: "정본",
            },
            {
              fact: "오타 의심",
              src: "라벨 DB(박스·스티커·멸균지 OCR 글자)와 표기 비교 · AI 검사는 선택",
              cond: "한 번 읽은 파일은 다시 읽지 않음",
              asof: "파일을 검사한 시각",
              tag: "기준 확인 필요",
            },
            {
              fact: "담당자 결정",
              src: "서버 결정 기록(review_decisions)",
              cond: "파일 내용 기준(경로가 달라도 같은 파일이면 같은 결정)",
              asof: "결정한 시각",
              tag: "정본",
            },
          ]}
        />
        <Explorer />
      </main>
    </div>
  );
}
