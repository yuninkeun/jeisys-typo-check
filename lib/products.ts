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

export function detectProductFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, "");
  for (const product of KNOWN_PRODUCTS) {
    if (base.toLowerCase().includes(product.toLowerCase())) return product;
  }
  return null;
}
