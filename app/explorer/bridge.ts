"use client";

import { useEffect, useState } from "react";
import { AUTO_SPLIT } from "@/lib/illustrator-script";

/** The Illustrator 연결 도우미 (scripts/illustrator-bridge/bridge.ps1) runs on
 *  the reviewer's PC and listens here; it opens the file in Illustrator, applies
 *  the fixes and saves `원본이름_날짜.ai` next to the original. */
const BRIDGE = "http://localhost:47811";

export type BridgeState = "checking" | "on" | "off";
/** What the running helper can do. OCR 비교 needs version 3 (it also keeps the OCR results on this PC). */
export type BridgeInfo = { state: BridgeState; ocr: boolean; old: boolean };

/** Whether the helper is running; checked again whenever this window is focused
 *  (e.g. after starting the helper). */
export function useBridgeInfo(): BridgeInfo {
  const [info, setInfo] = useState<BridgeInfo>({ state: "checking", ocr: false, old: false });
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(`${BRIDGE}/ping`, { signal: AbortSignal.timeout(1500) });
        const body = (await res.json()) as { ok?: boolean; ocr?: boolean; version?: string };
        if (alive) setInfo({ state: body.ok ? "on" : "off", ocr: !!body.ocr, old: !!body.ok && Number(body.version) < 3 });
      } catch {
        if (alive) setInfo({ state: "off", ocr: false, old: false });
      }
    };
    void check();
    window.addEventListener("focus", check);
    return () => {
      alive = false;
      window.removeEventListener("focus", check);
    };
  }, []);
  return info;
}

export function useBridge(): BridgeState {
  return useBridgeInfo().state;
}

export type OcrResult =
  | { ok: true; w: number; h: number; lines: { t: string; x: number; y: number; w: number; h: number }[] }
  | { ok: false; reason?: string; message: string };

/** Reads page 1 of a PDF-compatible file with Windows OCR on this PC (the file
 *  goes to the helper on localhost only). With `crop` (page fractions plus the
 *  line height), reads just that spot, enlarged. */
export async function ocrFile(file: Blob, crop?: { x: number; y: number; w: number; h: number; lh: number }): Promise<OcrResult> {
  const q = crop ? `?${new URLSearchParams(Object.entries(crop).map(([k, v]) => [k, v.toFixed(5)]))}` : "";
  try {
    const res = await fetch(`${BRIDGE}/ocr${q}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    });
    const body = (await res.json()) as OcrResult;
    // PowerShell may write an empty list as null.
    if (body.ok && !Array.isArray(body.lines)) return { ...body, lines: [] };
    return body;
  } catch {
    return { ok: false, reason: "offline", message: "연결 도우미에 닿지 못했습니다. 도우미 창이 켜져 있는지 확인해 주세요." };
  }
}

export type BridgeResult =
  | { ok: true; file: string; saved: string; report: string }
  | { ok: false; reason?: string; message: string };

/** Asks the helper to fix one file. `base` is the opened folder's name (null when
 *  several were opened: then it is the first part of `path`). */
export async function fixInIllustrator(req: {
  base: string | null;
  path: string;
  size?: number;
  fileName: string;
  script: string;
}): Promise<BridgeResult> {
  try {
    const res = await fetch(`${BRIDGE}/fix`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    return (await res.json()) as BridgeResult;
  } catch {
    return { ok: false, reason: "offline", message: "연결 도우미에 닿지 못했습니다. 도우미 창이 켜져 있는지 확인해 주세요." };
  }
}

/** The completed file the helper just saved, for the before/after view. */
export async function savedFile(path: string): Promise<Blob | null> {
  try {
    const res = await fetch(`${BRIDGE}/saved?path=${encodeURIComponent(path)}`);
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

export { AUTO_SPLIT };

/* ---- OCR results kept on this PC by the helper (%APPDATA%\JeisysTypoBridge\ocr),
 *      one file per label, until they are uploaded to the DB. ---- */

export type LocalLine = { t: string; bbox: { x: number; y: number; w: number; h: number }; memo: boolean };
export type LocalDoc = {
  hash: string;
  fileName: string;
  filePath: string;
  category: "박스" | "스티커" | "멸균지";
  w: number;
  h: number;
  lines: LocalLine[];
  compact: string;
};
export type LocalStats = { total: number; pending: number; byCategory: Record<string, number>; folder: string };

async function call<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${BRIDGE}${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json()) as T & { ok?: boolean };
    return json.ok ? json : null;
  } catch {
    return null;
  }
}

/** Labels already read on this PC (null = helper unreachable). */
export async function localGet(hashes: string[]): Promise<LocalDoc[] | null> {
  return (await call<{ docs: LocalDoc[] }>("/store/get", hashes))?.docs ?? null;
}

/** Keeps one label on this PC; false = not saved (already there, or failed). */
export async function localPut(doc: LocalDoc): Promise<boolean> {
  return !!(await call<{ saved: boolean }>("/store/put", doc))?.saved;
}

export async function localStats(): Promise<LocalStats | null> {
  return call<LocalStats>("/store/stats");
}

/** Labels on this PC not yet in the DB. */
export async function localPending(limit = 20): Promise<LocalDoc[] | null> {
  return (await call<{ docs: LocalDoc[] }>(`/store/pending?limit=${limit}`))?.docs ?? null;
}

export async function localMarkUploaded(hashes: string[]): Promise<boolean> {
  return !!(await call<{ marked: number }>("/store/uploaded", hashes));
}
