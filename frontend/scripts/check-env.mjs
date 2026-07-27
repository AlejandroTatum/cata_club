/**
 * Startup guard for required server-only environment variables.
 *
 * Runs BEFORE `next dev` / `next start` (see the "dev" and "start" scripts in
 * package.json) so a misconfigured checkout fails loudly at boot instead of
 * silently serving pages that collapse at the first backend call.
 *
 * Why this exists: `BACKEND_API_URL` is server-only and gitignored (it lives
 * in .env.local, which no clone ever carries). Without it the app still boots,
 * renders the landing page, and only breaks when someone tries to log in —
 * where it used to surface as "the service is unavailable, try again in a few
 * minutes". No amount of waiting fixes a missing variable. Boot time is the
 * honest place to say so.
 *
 * This guard does NOT run in the Docker runtime image, which starts the
 * standalone server directly (`node server.js`) and never copies scripts/.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Next's own loading order, narrowed to what this guard needs: the first file
 * to define a key wins, and anything already exported in the real environment
 * outranks every file.
 */
const ENV_FILES = [".env.local", ".env.development", ".env"];

/** Required server-only variables, each with the reason it cannot be defaulted. */
const REQUIRED = [
  {
    name: "BACKEND_API_URL",
    hint: "URL base del backend FastAPI, p. ej. http://localhost:8000/api/v1",
    validate: (value) => {
      let url;
      try {
        url = new URL(value);
      } catch {
        return "no es una URL absoluta válida";
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return `usa el protocolo "${url.protocol}" en lugar de http/https`;
      }
      return null;
    },
  },
];

/**
 * Minimal `KEY=value` parser. Deliberately not a dotenv dependency: this runs
 * before Next boots, so it must work with nothing installed beyond Node.
 * Handles comments, blank lines, `export ` prefixes, and surrounding quotes —
 * the shapes that actually appear in .env.local.example.
 */
function parseEnvFile(filePath) {
  const parsed = {};
  for (const rawLine of readFileSync(filePath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).replace(/^export\s+/, "").trim();
    if (key === "") continue;

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function resolveEnv() {
  const resolved = { ...process.env };
  for (const fileName of ENV_FILES) {
    const filePath = join(PROJECT_ROOT, fileName);
    if (!existsSync(filePath)) continue;
    for (const [key, value] of Object.entries(parseEnvFile(filePath))) {
      if (resolved[key] === undefined) resolved[key] = value;
    }
  }
  return resolved;
}

function main() {
  const env = resolveEnv();
  const problems = [];

  for (const { name, hint, validate } of REQUIRED) {
    const value = env[name];
    if (value === undefined || value.trim() === "") {
      problems.push({ name, detail: "falta", hint });
      continue;
    }
    const invalidReason = validate?.(value);
    if (invalidReason) {
      problems.push({ name, detail: invalidReason, hint });
    }
  }

  if (problems.length === 0) return;

  const hasEnvLocal = existsSync(join(PROJECT_ROOT, ".env.local"));

  console.error("");
  console.error("  ✖ Configuración inválida — el servidor no va a arrancar.");
  console.error("");
  for (const { name, detail, hint } of problems) {
    console.error(`    ${name}: ${detail}`);
    console.error(`      → ${hint}`);
  }
  console.error("");
  if (!hasEnvLocal) {
    console.error("    No existe frontend/.env.local. Está gitignoreado, así que");
    console.error("    ningún clone lo trae: hay que crearlo una vez por máquina.");
    console.error("");
    console.error("      cp .env.local.example .env.local");
  } else {
    console.error("    Revisá frontend/.env.local contra .env.local.example.");
  }
  console.error("");

  process.exit(1);
}

main();
