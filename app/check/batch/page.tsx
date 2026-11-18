import Link from "next/link";
import { AppHeader } from "../../components/app-header";
import { BatchForm } from "./batch-form";
import { Basis, Conclusion, DataBadge } from "../../components/standard";

export default function BatchExtractPage() {
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <AppHeader />

      <div className="flex min-w-0 flex-1 flex-col">
      <main className="flex w-full max-w-5xl min-w-0 flex-1 flex-col gap-6 px-4 py-6 md:px-8">
        <div className="flex flex-col gap-1">
          <Link
            href="/check"
            className="text-xs text-ink-muted underline hover:text-ink"
          >
            ← 파일 검증으로 돌아가기
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-bold leading-tight text-ink">폴더 일괄 텍스트 추출</h1>
            <DataBadge />
          </div>
          <p className="text-sm text-ink-muted">
            서버(이 앱을 실행 중인 PC)의 폴더 경로를 입력하면 그 안의 모든 PDF를
            찾아 텍스트를 추출하고, 같은 폴더에 CSV 파일로 저장합니다. 로컬
            실행(next dev) 중에만 동작합니다.
          </p>
        </div>

        <Basis
          rows={[
            {
              fact: "PDF 텍스트",
              src: "이 앱을 실행 중인 PC의 폴더",
              cond: "하위 폴더 포함 모든 PDF",
              asof: "추출을 누른 시각",
              tag: "정본",
            },
          ]}
        />
        <BatchForm />
        <Conclusion>
          로컬 실행(next dev) 중에 폴더 경로를 넣어 CSV를 만들고, 오탈자 판정은 파일 검증 화면에서 한다.
        </Conclusion>
      </main>

      <footer className="border-t border-line py-5">
        <p className="max-w-5xl px-4 text-xs text-ink-faint md:px-8">
          제이시스메디칼 사내 검수 도구 · 추출된 텍스트는 참고용이며 오탈자
          확인은 파일 검증 기능을 이용해 주세요.
        </p>
      </footer>
      </div>
    </div>
  );
}
