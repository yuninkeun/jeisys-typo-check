import Link from "next/link";
import { AppHeader } from "../../components/app-header";
import { BatchForm } from "./batch-form";

export default function BatchExtractPage() {
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
        <div className="flex flex-col gap-1">
          <Link
            href="/check"
            className="text-xs text-ink-muted underline hover:text-ink"
          >
            ← 파일 검증으로 돌아가기
          </Link>
          <h1 className="text-xl font-bold text-ink">폴더 일괄 텍스트 추출</h1>
          <p className="text-sm text-ink-muted">
            서버(이 앱을 실행 중인 PC)의 폴더 경로를 입력하면 그 안의 모든 PDF를
            찾아 텍스트를 추출하고, 같은 폴더에 CSV 파일로 저장합니다. 로컬
            실행(next dev) 중에만 동작합니다.
          </p>
        </div>

        <BatchForm />
      </main>

      <footer className="border-t border-line py-5">
        <p className="mx-auto max-w-5xl px-6 text-xs text-ink-faint">
          제이시스메디칼 사내 검수 도구 · 추출된 텍스트는 참고용이며 오탈자
          확인은 파일 검증 기능을 이용해 주세요.
        </p>
      </footer>
    </div>
  );
}
