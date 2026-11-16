import { AppHeader } from "../components/app-header";
import { Explorer } from "./explorer";

export const metadata = { title: "폴더 탐색 · Jeisys 오타 검증" };

export default function ExplorerPage() {
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-6 py-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-ink">폴더 탐색</h1>
          <p className="text-sm text-ink-muted">
            폴더 구조에서 AI·PDF 파일을 찾아 오타를 검사하고, 고친 내용을 Illustrator
            스크립트로 받아 텍스트만 수정합니다.
          </p>
        </div>
        <Explorer />
      </main>
    </div>
  );
}
