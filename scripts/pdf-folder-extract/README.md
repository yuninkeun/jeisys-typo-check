# PDF 폴더 일괄 텍스트 추출기 (로컬 독립 실행 파일)

배포된 검증 사이트는 서버(Vercel)가 여러분 PC의 폴더에 접근할 수 없어서, "폴더 지정 → 일괄 처리"는 각자 PC에서 실행하는 별도 프로그램으로 만들었습니다. 이 프로그램은 PDF에서 텍스트만 추출해 CSV로 저장합니다(오탈자 검사는 하지 않음). 오탈자 검사는 사이트의 파일 업로드 기능을 그대로 이용해 주세요.

## 사용 방법 (받는 사람)

1. `pdf-folder-extract.exe`와 `pdf.worker.mjs`를 **같은 폴더**에 받으세요. (둘 다 있어야 동작합니다.)
2. 검사하고 싶은 PDF가 들어있는 폴더를 `pdf-folder-extract.exe` 위로 끌어다 놓으세요.
   - 또는 그냥 더블클릭해서 실행한 뒤, 열리는 창에 폴더 경로를 붙여넣고 Enter.
3. 하위 폴더까지 모든 PDF를 찾아 텍스트를 추출하고, 같은 폴더 안에 `pdf-text-extract_<시간>.csv` 파일을 만듭니다.
4. Node.js 설치, 인터넷 연결, 로그인 모두 필요 없습니다. 추출한 내용은 그 PC를 벗어나지 않습니다.

## 다시 빌드하기 (개발자용)

`extract-source.cjs`를 고친 뒤:

```
node scripts/pdf-folder-extract/build.cjs
```

Node 20+ 가 설치된 PC에서 실행하세요. 결과로 `pdf-folder-extract.exe`가 다시 만들어집니다. `pdf.worker.mjs`는 `node_modules/pdf-parse`가 바뀌지 않는 한 다시 복사할 필요 없습니다.
