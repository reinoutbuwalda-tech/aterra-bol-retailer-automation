export const ALLOWED_EMAILS = new Set([
  "reinout.buwalda@gmail.com",
  "t.w.dewaard@gmail.com",
]);

export const PRODUCT_NAMES: Record<string, string> = {
  "6970452112658": "Besrey Fort Kit",
  "8720892887504": "Water Karaf",
  "8720892887511": "Stainless Steel Waterkan",
  "8720892887528": "XL Sporttas",
};

export const REPORT_BUCKET = "bol-retailer-html-reports";

export function requireEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}
