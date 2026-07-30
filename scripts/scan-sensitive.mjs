import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const attributionPath = path.join(root, "src", "core", "attribution.ts");
const attributionSource = fs.readFileSync(attributionPath, "utf8");
const attribution = attributionSource.match(/const ORDER_ATTRIBUTION = "([A-Za-z0-9]+)";/)?.[1];

if (!attribution) throw new Error("Order attribution constant is missing or malformed");

const ignoredDirectories = new Set([".git", "dist", "node_modules"]);
const textExtensions = new Set([".env", ".json", ".md", ".mjs", ".ts", ".toml", ".yaml", ".yml"]);
const files = walk(root);
const failures = [];

for (const file of files) {
  const relative = path.relative(root, file);
  const text = fs.readFileSync(file, "utf8");
  if (file !== attributionPath && text.includes(attribution)) failures.push(`${relative}: internal attribution value is exposed`);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) failures.push(`${relative}: private key material detected`);
  if (/OKX_API_(?:KEY|SECRET|PASSPHRASE)[ \t]*=[ \t]*[^\s#]+/.test(text)) failures.push(`${relative}: populated OKX environment credential detected`);
}

for (const directory of ["README.md", "skills", "examples", path.join("src", "tools")]) {
  const target = path.join(root, directory);
  const candidates = fs.statSync(target).isDirectory() ? walk(target) : [target];
  for (const file of candidates) {
    if (/\btag\b/i.test(fs.readFileSync(file, "utf8"))) failures.push(`${path.relative(root, file)}: unsupported attribution field is documented`);
  }
}

if (failures.length) throw new Error(`Sensitive information scan failed:\n${failures.join("\n")}`);
console.log(`Sensitive information scan passed (${files.length} source files checked)`);

function walk(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    const extension = path.extname(entry.name);
    return textExtensions.has(extension) || entry.name === ".env.example" ? [fullPath] : [];
  });
}
