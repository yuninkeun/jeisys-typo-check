"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "application/pdf"]);
const MODEL = "gpt-4o";

// Known product lines, longest-name-first so "ULTRAcel Q+" wins over a bare "Q+".
const KNOWN_PRODUCTS = [
  "ULTRAcel Q+",
  "ULTRAcel II",
  "ULTRAcel",
  "DENSITY NOIR",
  "DENSITY",
  "POTENZA PRIME",
  "POTENZA",
  "LINEARZ",
  "LINEA",
  "TRI-BEAM",
  "D'Liv",
  "Cellec V",
  "Cellec",
  "LIPOcel",
  "SmoothCool",
  "Aquacel",
  "IntraCel",
  "Edge One",
  "McCoom",
  "IPL",
].sort((a, b) => b.length - a.length);

function detectProductFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, "");
  for (const product of KNOWN_PRODUCTS) {
    if (base.toLowerCase().includes(product.toLowerCase())) return product;
  }
  return null;
}

export type BBox = { x: number; y: number; w: number; h: number };

type ExtractedLine = {
  text: string;
  is_flagged: boolean;
  flag_reason?: string;
  suggested_text?: string;
  page?: number;
  bbox?: BBox;
};

export type CheckState = {
  error?: string;
  documentId?: string;
  fileName?: string;
  product?: string | null;
  lines?: ExtractedLine[];
};

const SYSTEM_PROMPT = `당신은 의료기기 회사(제이시스메디칼)의 제품 스티커·라벨·리플렛 인쇄용 일러스트 파일에서 오탈자를 찾는 검수자입니다.

다음을 수행하세요:
1. 파일 안의 모든 텍스트를 줄 단위로 추출합니다 (한글, 영문, 숫자, 기호 포함, 보이는 순서대로. PDF라면 모든 페이지를 순서대로 처리).
2. 각 줄에 대해 명백한 오탈자, 띄어쓰기 오류, 일관성 없는 표기(예: 같은 시리즈에서 "Q 2.0"이어야 할 것이 "QS 2.0"처럼 튀는 경우)가 있는지 판단합니다.
3. 아래 "과거에 확인된 유사 텍스트" 목록이 주어지면, 이번 텍스트가 그 목록과 표기가 다른데 같은 의미로 보이면 반드시 지적하세요. 이것이 가장 중요한 오탈자 발견 방법입니다.
4. 확신이 없으면 is_flagged를 false로 둡니다. 제품명, 코드, 숫자는 실제 오류가 아니면 건드리지 않습니다.

5. 각 줄이 페이지의 어디에 있는지 위치도 함께 알려주세요. page는 1부터 시작하는 페이지 번호,
   bbox는 페이지 전체 대비 비율(0~1)입니다: x=왼쪽 끝, y=위쪽 끝, w=가로 길이, h=세로 높이.

반드시 아래 JSON 형식으로만 응답하세요. 코드블록이나 다른 설명 없이 JSON 객체 하나만 출력합니다.
{
  "lines": [
    { "text": "추출된 원문 그대로", "is_flagged": boolean, "flag_reason": "오탈자로 판단한 이유 (한국어, is_flagged가 true일 때만)", "suggested_text": "수정 제안 (is_flagged가 true일 때만)", "page": 1, "bbox": { "x": 0.1, "y": 0.2, "w": 0.5, "h": 0.06 } }
  ]
}`;

async function assertSignedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("로그인이 필요합니다.");
  return user;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function findHistoryForProduct(supabase: SupabaseServerClient, product: string | null) {
  if (!product) return [] as string[];
  const { data } = await supabase
    .from("text_extractions")
    .select("text, documents!inner(product)")
    .eq("documents.product", product)
    .order("created_at", { ascending: false })
    .limit(60);
  const seen = new Set<string>();
  for (const row of data ?? []) {
    seen.add(row.text);
  }
  return [...seen].slice(0, 40);
}

/** Flags a line as a consistency issue when it closely, but not exactly,
 * matches earlier text from a different document (e.g. "QS 2.0" vs "Q 2.0"). */
async function checkConsistencyAgainstHistory(
  supabase: SupabaseServerClient,
  lines: ExtractedLine[],
) {
  const SIMILARITY_THRESHOLD = 0.6;
  const results = [...lines];

  await Promise.all(
    results.map(async (line, index) => {
      if (line.is_flagged || !line.text.trim()) return;
      const { data } = await supabase.rpc("similar_extracted_texts", {
        query_text: line.text,
        match_count: 5,
      });
      const closeMatch = (data ?? []).find(
        (r: { text: string; similarity: number }) =>
          r.similarity >= SIMILARITY_THRESHOLD &&
          r.text.trim() !== line.text.trim(),
      );
      if (closeMatch) {
        results[index] = {
          ...line,
          is_flagged: true,
          flag_reason: `과거 이력의 "${closeMatch.text}"와 표기가 다릅니다. 오탈자이거나 의도된 변경인지 확인이 필요합니다.`,
          suggested_text: closeMatch.text,
        };
      }
    }),
  );

  return results;
}

function buildHistoryContext(priorLines: string[]) {
  return priorLines.length > 0
    ? `과거에 확인된 유사 텍스트 (참고용, 표기가 다르면 지적하세요):\n${priorLines
        .map((t) => `- ${t}`)
        .join("\n")}`
    : "과거에 확인된 유사 텍스트가 없습니다. 이번이 첫 확인입니다.";
}

async function extractWithOpenAI(
  file: File,
  bytes: Uint8Array,
  historyContext: string,
): Promise<ExtractedLine[]> {
  const base64 = Buffer.from(bytes).toString("base64");
  const fileContent =
    file.type === "application/pdf"
      ? {
          type: "input_file" as const,
          filename: file.name,
          file_data: `data:application/pdf;base64,${base64}`,
        }
      : {
          type: "input_image" as const,
          image_url: `data:${file.type};base64,${base64}`,
        };

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: SYSTEM_PROMPT }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: historyContext }, fileContent],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OpenAI 요청 실패 (${res.status}): ${detail.slice(0, 300)}`);
  }

  const json = await res.json();
  const outputText: string =
    json.output_text ??
    json.output
      ?.flatMap((item: { content?: { text?: string }[] }) => item.content ?? [])
      .map((c: { text?: string }) => c.text)
      .filter(Boolean)
      .join("\n") ??
    "{}";

  const cleaned = outputText.trim().replace(/^```(json)?/i, "").replace(/```$/, "");
  const parsed = JSON.parse(cleaned) as { lines?: ExtractedLine[] };
  return parsed.lines ?? [];
}

export async function uploadAndCheck(
  _prev: CheckState,
  formData: FormData,
): Promise<CheckState> {
  const user = await assertSignedIn();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "파일을 선택해 주세요." };
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return { error: "PNG, JPG, PDF 파일만 업로드할 수 있습니다." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { error: "파일 용량은 25MB를 넘을 수 없습니다." };
  }

  const product = detectProductFromFilename(file.name);
  const supabase = await createClient();
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  // Supabase Storage keys must be ASCII-safe; the original (possibly Korean/
  // bracketed) filename is preserved separately in documents.original_filename.
  const extMatch = file.name.match(/\.[a-zA-Z0-9]+$/);
  const ext = extMatch ? extMatch[0] : "";
  const storagePath = `${user.id}/${Date.now()}-${crypto.randomUUID()}${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("illustrations")
    .upload(storagePath, bytes, { contentType: file.type });

  if (uploadError) {
    return { error: `파일 업로드에 실패했습니다: ${uploadError.message}` };
  }

  const { data: doc, error: docError } = await supabase
    .from("documents")
    .insert({
      user_id: user.id,
      original_filename: file.name,
      storage_path: storagePath,
      mime_type: file.type,
      product,
      model_used: MODEL,
      status: "processing",
    })
    .select("id")
    .single();

  if (docError || !doc) {
    return { error: `기록 생성에 실패했습니다: ${docError?.message}` };
  }

  try {
    const priorLines = await findHistoryForProduct(supabase, product);
    const extracted = await extractWithOpenAI(
      file,
      bytes,
      buildHistoryContext(priorLines),
    );
    const lines = await checkConsistencyAgainstHistory(supabase, extracted);

    if (lines.length > 0) {
      const rows = lines.map((line, index) => ({
        document_id: doc.id,
        line_index: index,
        text: line.text,
        is_flagged: Boolean(line.is_flagged),
        flag_reason: line.is_flagged ? line.flag_reason ?? null : null,
        suggested_text: line.is_flagged ? line.suggested_text ?? null : null,
        page: line.page ?? null,
        bbox: line.bbox ?? null,
      }));
      const { error: insertError } = await supabase
        .from("text_extractions")
        .insert(rows);
      if (insertError) throw new Error(insertError.message);
    }

    await supabase.from("documents").update({ status: "done" }).eq("id", doc.id);

    revalidatePath("/check");
    return {
      documentId: doc.id,
      fileName: file.name,
      product,
      lines,
    };
  } catch (err) {
    await supabase
      .from("documents")
      .update({ status: "failed" })
      .eq("id", doc.id);
    return {
      error: err instanceof Error ? err.message : "검증 중 오류가 발생했습니다.",
      documentId: doc.id,
    };
  }
}
