/**
 * Extracción genérica de datos de notificaciones bancarias en español.
 * Funciona con texto plano y con HTML (tablas de etiqueta/valor).
 */

/** HTML → texto con una celda/párrafo por línea. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|table|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#36;|&dollar;/gi, "$")
    .replace(/&aacute;/gi, "á").replace(/&eacute;/gi, "é").replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó").replace(/&uacute;/gi, "ú").replace(/&ntilde;/gi, "ñ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

/**
 * Convierte "1.234,56", "1,234.56", "25,50", "25.50", "1.500" a número.
 * Regla: si hay "." y ",", el último es el decimal. Si hay un solo separador
 * seguido de exactamente 3 dígitos, es de miles.
 */
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    normalized = s.split(thou).join("").replace(dec, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    normalized = parts.length === 2 && tail.length !== 3 ? parts.join(".") : parts.join("");
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

const MONEY = /(?:US\s?\$|USD|\$)\s*([\d][\d.,]*)|([\d][\d.,]*)\s*(?:USD|dólares|dolares)/i;

const LABELS = {
  amount: /^(?:el\s+)?(?:monto|valor|importe|cantidad|total)(?:\s+(?:transferido|recibido|acreditado|de\s+la\s+transferencia|del\s+cr[eé]dito))?\b/i,
  reference: /^(?:n[uú]mero\s+de\s+(?:comprobante|referencia|documento|transacci[oó]n|operaci[oó]n)|n[°ºo.]*\s*(?:de\s+)?(?:comprobante|referencia|documento)|comprobante|secuencial|c[oó]digo\s+de\s+transacci[oó]n|documento)\b/i,
  memo: /^(?:concepto|descripci[oó]n|motivo|detalle(?:\s+de\s+la\s+transferencia)?|mensaje|comentario|glosa|referencia\s+del\s+pago|observaci[oó]n)\b/i,
  sender: /^(?:ordenante|nombre\s+del\s+ordenante|remitente|de\s+parte\s+de|enviado\s+por|origen|cliente\s+ordenante|transferido\s+por|desde)\b/i,
};

type Field = keyof typeof LABELS;

/** Busca "Etiqueta: valor" en la misma línea, o la etiqueta en una línea y el valor en la siguiente. */
export function findLabeled(lines: string[], field: Field): string | null {
  const re = LABELS[field];
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    let value = lines[i].slice(m[0].length).replace(/^[\s:.\-–]+/, "").trim();
    if (!value && i + 1 < lines.length && !Object.values(LABELS).some((r) => r.test(lines[i + 1]))) {
      value = lines[i + 1].trim();
    }
    if (value) return value.slice(0, 250);
  }
  return null;
}

export function findAmount(lines: string[], fullText: string): number | null {
  const labeled = findLabeled(lines, "amount");
  if (labeled) {
    const m = MONEY.exec(labeled);
    const n = parseAmount(m ? (m[1] ?? m[2]) : labeled);
    if (n) return n;
  }
  const m = MONEY.exec(fullText);
  return m ? parseAmount(m[1] ?? m[2]) : null;
}

/** Códigos de venta en cualquier parte del correo: V-1234, V1234, v 1234, V_1234. */
export function findSaleCodes(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<![A-Z0-9])V[\s\-_.]?(\d{4})(?!\d)/gi)) out.add(`V-${m[1]}`);
  return [...out];
}

const CREDIT = /(recibiste|has\s+recibido|hemos\s+acreditado|se\s+(?:ha\s+)?acredit|acreditaci[oó]n|cr[eé]dito\s+a\s+tu\s+cuenta|transferencia\s+recibida|te\s+(?:han\s+)?transferi|te\s+envi[oó]|a\s+tu\s+favor|ingres[oó]\s+a\s+tu\s+cuenta|dep[oó]sito\s+recibido|recibiste\s+un\s+pago|cobro\s+recibido)/i;
const DEBIT = /(realizaste|has\s+realizado|enviaste|has\s+enviado|transferencia\s+enviada|se\s+(?:ha\s+)?debitad|d[eé]bito\s+(?:de|a)\s+tu\s+cuenta|pago\s+realizado|retiro|consumo|compra\s+(?:aprobada|realizada)|avance\s+de\s+efectivo)/i;

/** ¿Es dinero que ENTRA (credit), que SALE (debit) o no se sabe? */
export function direction(text: string): "credit" | "debit" | "unknown" {
  const c = CREDIT.test(text);
  const d = DEBIT.test(text);
  if (c && !d) return "credit";
  if (d && !c) return "debit";
  if (c && d) {
    // Ambos: gana el que aparece primero (normalmente el asunto/encabezado)
    return text.search(CREDIT) <= text.search(DEBIT) ? "credit" : "debit";
  }
  return "unknown";
}
