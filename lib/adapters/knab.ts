export type KnabStatementSummary = { openingBalance: number; credits: number; debits: number; closingBalance: number; currency: "EUR" };

function eur(value: string) { return Number(value.replace(/\./g, "").replace(",", ".")); }
export function parseKnabStatementText(text: string): KnabStatementSummary {
  const find = (labels: string[]) => { for (const label of labels) { const match = text.match(new RegExp(`${label}[^0-9-]*(-?[0-9.]+,[0-9]{2})`, "i")); if (match) return eur(match[1]); } throw new Error(`Missing KNAB field: ${labels[0]}`); };
  return { openingBalance: find(["Beginsaldo", "Saldo begin"]), credits: find(["Bijgeschreven", "Credit"]), debits: find(["Afgeschreven", "Debet"]), closingBalance: find(["Eindsaldo", "Saldo einde"]), currency: "EUR" };
}
