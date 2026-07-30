import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skills = path.join(root, "skills");
const validator = "/Users/xiazhi/.codex/skills/.system/skill-creator/scripts/quick_validate.py";

for (const entry of fs.readdirSync(skills, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = path.join(skills, entry.name);
  const skill = fs.readFileSync(path.join(directory, "SKILL.md"), "utf8");
  const metadata = fs.readFileSync(path.join(directory, "agents", "openai.yaml"), "utf8");
  if (skill.includes("TODO")) throw new Error(`${entry.name} contains an unfinished TODO`);
  if (!metadata.includes(`$${entry.name}`)) throw new Error(`${entry.name} default_prompt does not reference the skill`);
  if (fs.existsSync(validator)) {
    execFileSync("python3", [validator, directory], { stdio: "inherit" });
  }
}
