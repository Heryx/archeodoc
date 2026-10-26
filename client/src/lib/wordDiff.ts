export type DiffPart = { text: string; kind: "same" | "add" | "del" };

const MAX_CELLS = 2_500_000;

function pushPart(parts: DiffPart[], text: string, kind: DiffPart["kind"]) {
  const last = parts[parts.length - 1];
  if (last && last.kind === kind) last.text += text;
  else parts.push({ text, kind });
}

/** Differenze fra due testi, parola per parola. Restituisce null se i testi sono troppo lunghi da confrontare. */
export function diffWords(before: string, after: string): DiffPart[] | null {
  const a = before.split(/(\s+)/).filter((t) => t !== "");
  const b = after.split(/(\s+)/).filter((t) => t !== "");
  if (a.length * b.length > MAX_CELLS) return null;

  // Sottosequenza comune più lunga, costruita dalla coda.
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pushPart(parts, a[i], "same");
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      pushPart(parts, a[i++], "del");
    } else {
      pushPart(parts, b[j++], "add");
    }
  }
  while (i < a.length) pushPart(parts, a[i++], "del");
  while (j < b.length) pushPart(parts, b[j++], "add");
  return parts;
}
