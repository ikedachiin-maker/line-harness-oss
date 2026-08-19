import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execa, type Options as ExecaOptions } from "execa";

const DEFAULT_PNPM_VERSION = "9.15.4";

interface ResolvedPnpmSpec {
  corepackSpec: string;
  npmSpec: string;
}

function resolvePnpmSpec(repoDir: string): ResolvedPnpmSpec {
  const packageJsonPath = join(repoDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    return {
      corepackSpec: `pnpm@${DEFAULT_PNPM_VERSION}`,
      npmSpec: `pnpm@${DEFAULT_PNPM_VERSION}`,
    };
  }

  try {
    const packageJson = JSON.parse(
      readFileSync(packageJsonPath, "utf-8"),
    ) as { packageManager?: unknown };
    const packageManager = packageJson.packageManager;
    if (
      typeof packageManager === "string" &&
      packageManager.startsWith("pnpm@")
    ) {
      const version = packageManager.slice("pnpm@".length).split("+")[0];
      return {
        corepackSpec: packageManager,
        npmSpec: `pnpm@${version}`,
      };
    }
  } catch {
    // Fall back to the known-good version declared by this repo today.
  }

  return {
    corepackSpec: `pnpm@${DEFAULT_PNPM_VERSION}`,
    npmSpec: `pnpm@${DEFAULT_PNPM_VERSION}`,
  };
}

function getErrorText(error: unknown): string {
  if (error && typeof error === "object") {
    const execaError = error as {
      message?: string;
      shortMessage?: string;
      stderr?: string;
    };
    return [
      execaError.shortMessage,
      execaError.message,
      execaError.stderr,
    ]
      .filter((value): value is string => typeof value === "string")
      .join("\n");
  }
  return String(error);
}

function shouldFallbackFromCorepack(error: unknown): boolean {
  const text = getErrorText(error).toLowerCase();
  return (
    text.includes("corepack") ||
    text.includes(".cache/node/corepack") ||
    text.includes("spawn corepack") ||
    text.includes("enoent") ||
    text.includes("eperm") ||
    text.includes("eacces") ||
    text.includes("cannot find matching keyid") ||
    text.includes("internal error") ||
    text.includes("failed to download")
  );
}

export async function repoPnpm(
  repoDir: string,
  args: string[],
  options?: ExecaOptions,
) {
  const spec = resolvePnpmSpec(repoDir);

  try {
    return await execa("corepack", [spec.corepackSpec, ...args], options);
  } catch (error) {
    if (!shouldFallbackFromCorepack(error)) {
      throw error;
    }

    return await execa("npx", ["-y", spec.npmSpec, ...args], options);
  }
}
