import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJsonPath = join(packageDir, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const dependencyFields = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];

const workspaceSpecs = [];
for (const field of dependencyFields) {
  const deps = packageJson[field];
  if (!deps || typeof deps !== "object") continue;
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec === "string" && spec.startsWith("workspace:")) {
      workspaceSpecs.push(`${field}.${name}=${spec}`);
    }
  }
}

if (workspaceSpecs.length === 0) {
  process.exit(0);
}

if (process.env.LINE_HARNESS_ALLOW_SOURCE_PUBLISH === "1") {
  process.exit(0);
}

const userAgent = process.env.npm_config_user_agent ?? "";
if (userAgent.includes("pnpm/")) {
  process.exit(0);
}

console.error(
  [
    "Refusing to publish create-line-harness from source with npm.",
    "This package still contains workspace: dependency specs that npm would publish verbatim:",
    ...workspaceSpecs.map((entry) => `  - ${entry}`),
    "",
    "Use one of these flows instead:",
    "  1. pnpm publish --access public --no-git-checks",
    "  2. pnpm pack --pack-destination <dir> && npm publish <dir>/create-line-harness-<version>.tgz --access public",
    "",
    "Set LINE_HARNESS_ALLOW_SOURCE_PUBLISH=1 only if you intentionally want to bypass this guard.",
  ].join("\n"),
);
process.exit(1);
