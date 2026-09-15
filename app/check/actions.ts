"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg"]);
const MODEL = "gpt-4o";

type ExtractedLine = {
  text: string;
  is_flagged: boolean;
  flag_reason?: string;
  suggested_text?: string;
};

export type CheckState = {
  error?: string;
  documentId?: string;
  fileName?: string;
  lines?: ExtractedLine[];
};

const SYSTEM_PROMPT = `당신은 의료기기 회사(제이시스메디칼)의 제품 스티커·라벨·리플렛 인쇄용 일러스트 파일에서 오탈자를 찾는 검수자입니다.

다음을 수행하세요:
1. 이미지 안의 모든 텍스트를 줄 단위로 추출합니다 (한글, 영문, 숫자, 기호 포함, 보이는 순서대로).
2. 각 줄에 대해 명백한 오탈자, 띄어쓰기 오류, 일관성 없는 표기(예: 같은 시리즈에서 "Q 2.0"이어야 할 것이 "QS 2.0"처럼 튀는 경우)가 있는지 판단합니다.
3. 아래 "과거에 확인된 유사 텍스트" 목록이 주어지면, 이번 텍스트가 그 목록과 표기가 다른데 같은 의미로 보이면 반드시 지적하세요. 이것이 가장 중요한 오탈자 발견 방법입니다.
4. 확신이 없으면 is_flagged를 false로 둡니다. 제품명, 코드, 숫자는 실제 오류가 아니면 건드리지 않습니다.

반드시 아래 JSON 스키마로만 응답하세요. 다른 설명은 절대 포함하지 마세요.
{
  "lines": [
    { "text": "추출된 원문 그대로", "is_flagged": boolean, "flag_reason": "오탈자로 판단한 이유 (한국어, is_flagged가 true일 때만)", "suggested_text": "수정 제안 (is_flagged가 true일 때만)" }
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

async function findHistoryForProduct(supabase: SupabaseServerClient, product: string) {
  if (!product.trim()) return [] as string[];
  const { data } = await supabase
    .from("text_extractions")
    .select("text, documents!inner(product)")
    .ilike("documents.product", product)
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

export async function uploadAndCheck(
  _prev: CheckState,
  formData: FormData,
): Promise<CheckState> {
  const user = await assertSignedIn();
  const file = formData.get("file");
  const product = String(formData.get("product") ?? "").trim();

  if (!(file instanceof File) || file.size === 0) {
    return { error: "파일을 선택해 주세요." };
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return { error: "PNG, JPG 파일만 업로드할 수 있습니다. (PDF는 다음 업데이트 예정)" };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { error: "파일 용량은 25MB를 넘을 수 없습니다." };
  }

  const supabase = await createClient();
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const storagePath = `${user.id}/${Date.now()}-${file.name}`;

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
      product: product || null,
      model_used: MODEL,
      status: "processing",
    })
    .select("id")
    .single();

  if (docError || !doc) {
    return { error: `기록 생성에 실패했습니다: ${docError?.message}` };
  }

  try {
    const base64 = Buffer.from(bytes).toString("base64");
    const priorLines = await findHistoryForProduct(supabase, product);

    const userContent: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [
      {
        type: "text",
        text:
          priorLines.length > 0
            ? `과거에 확인된 유사 텍스트 (참고용, 표기가 다르면 지적하세요):\n${priorLines
                .slice(0, 40)
                .map((t) => `- ${t}`)
                .join("\n")}`
            : "과거에 확인된 유사 텍스트가 없습니다. 이번이 첫 확인입니다.",
      },
      { type: "image_url", image_url: { url: `data:${file.type};base64,${base64}` } },
    ];

    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!completion.ok) {
      const detail = await completion.text();
      throw new Error(`OpenAI 요청 실패 (${completion.status}): ${detail.slice(0, 300)}`);
    }

    const completionJson = await completion.json();
    const raw = completionJson.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { lines?: ExtractedLine[] };
    const lines = await checkConsistencyAgainstHistory(
      supabase,
      parsed.lines ?? [],
    );

    if (lines.length > 0) {
      const rows = lines.map((line, index) => ({
        document_id: doc.id,
        line_index: index,
        text: line.text,
        is_flagged: Boolean(line.is_flagged),
        flag_reason: line.is_flagged ? line.flag_reason ?? null : null,
        suggested_text: line.is_flagged ? line.suggested_text ?? null : null,
      }));
      const { error: insertError } = await supabase
        .from("text_extractions")
        .insert(rows);
      if (insertError) throw new Error(insertError.message);
    }

    await supabase.from("documents").update({ status: "done" }).eq("id", doc.id);
    revalidatePath("/check");
    return { documentId: doc.id, fileName: file.name, lines };
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
