"use client";

import { useEffect, useState } from "react";
import { AUTO_SPLIT } from "@/lib/illustrator-script";

/** The Illustrator 연결 도우미 (scripts/illustrator-bridge/bridge.ps1) runs on
 *  the reviewer's PC and listens here; it opens the file in Illustrator, applies
 *  the fixes and saves `원본이름_날짜.ai` next to the original. */
const BRIDGE = "http://localhost:47811";

export type BridgeState = "checking" | "on" | "off";

/** Whether the helper is running; checked again whenever this window is focused
 *  (e.g. after starting the helper). */
export function useBridge(): BridgeState {
  const [state, setState] = useState<BridgeState>("checking");
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(`${BRIDGE}/ping`, { signal: AbortSignal.timeout(1500) });
        const body = (await res.json()) as { ok?: boolean };
        if (alive) setState(body.ok ? "on" : "off");
      } catch {
        if (alive) setState("off");
      }
    };
    void check();
    window.addEventListener("focus", check);
    return () => {
      alive = false;
      window.removeEventListener("focus", check);
    };
  }, []);
  return state;
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
