/** Splits text into ~size-character chunks on paragraph and sentence boundaries, with overlap. */
export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const p of paras) {
    if (p.length <= size) pieces.push(p);
    else pieces.push(...(p.match(/[^.!?]+[.!?]+["')\]]?\s*|[^.!?]+$/g) ?? [p]).map((s) => s.trim()));
  }
  const chunks: string[] = [];
  let cur = "";
  for (const piece of pieces) {
    if (cur && cur.length + piece.length + 2 > size) {
      chunks.push(cur);
      cur = cur.slice(Math.max(0, cur.length - overlap)).replace(/^\S*\s/, "");
    }
    cur = cur ? `${cur}\n\n${piece}` : piece;
    while (cur.length > size * 1.5) {
      chunks.push(cur.slice(0, size));
      cur = cur.slice(size - overlap);
    }
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}
