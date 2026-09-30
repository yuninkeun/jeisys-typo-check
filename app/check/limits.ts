// Uploads go through a Server Action, so the real ceiling is Vercel's 4.5MB
// function request body limit. Keep this below it (next.config.ts sets the
// Server Action bodySizeLimit to match) so an oversized file gets a friendly
// message instead of being rejected before the action runs.
export const MAX_FILE_MB = 4;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

export function fileTooLargeMessage(size: number) {
  const mb = (size / (1024 * 1024)).toFixed(1);
  return `파일이 너무 커요 (${mb}MB). 최대 ${MAX_FILE_MB}MB까지 올릴 수 있습니다. PDF라면 용량을 줄이거나 페이지를 나눠서 올려 주세요.`;
}
