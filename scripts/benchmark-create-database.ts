import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../packages/create-line-harness/src/steps/database.ts';
import { setAccountId, wrangler } from '../packages/create-line-harness/src/lib/wrangler.ts';

interface CliOptions {
  accountId: string;
  mode: 'legacy' | 'bootstrap' | 'both';
  repoSource: string;
  prefix: string;
}

interface BenchmarkResult {
  label: 'legacy' | 'bootstrap';
  databaseName: string;
  elapsedMs: number;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let accountId = '';
  let mode: CliOptions['mode'] = 'both';
  let repoSource = REPO_ROOT;
  let prefix = `lhbench-${Date.now().toString(36)}`;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--account-id' && args[i + 1]) {
      accountId = args[i + 1];
      i += 1;
    } else if (arg === '--mode' && args[i + 1]) {
      const value = args[i + 1];
      if (value === 'legacy' || value === 'bootstrap' || value === 'both') {
        mode = value;
      } else {
        throw new Error(`Invalid --mode: ${value}`);
      }
      i += 1;
    } else if (arg === '--repo-source' && args[i + 1]) {
      repoSource = resolve(args[i + 1]);
      i += 1;
    } else if (arg === '--prefix' && args[i + 1]) {
      prefix = args[i + 1];
      i += 1;
    }
  }

  if (!accountId) {
    throw new Error('Missing required --account-id');
  }

  return { accountId, mode, repoSource, prefix };
}

function prepareRepoVariant(
  workspaceRoot: string,
  variantRoot: string,
  mode: 'legacy' | 'bootstrap',
): string {
  const sourceDbDir = join(workspaceRoot, 'packages', 'db');
  const targetRepoDir = join(variantRoot, mode);
  const targetDbDir = join(targetRepoDir, 'packages', 'db');

  mkdirSync(join(targetRepoDir, 'packages'), { recursive: true });
  cpSync(sourceDbDir, targetDbDir, { recursive: true });

  if (mode === 'legacy') {
    for (const file of ['bootstrap.sql', 'bootstrap-meta.json']) {
      const path = join(targetDbDir, file);
      if (existsSync(path)) {
        rmSync(path, { force: true });
      }
    }
  }

  return targetRepoDir;
}

async function cleanupDatabase(databaseName: string): Promise<void> {
  try {
    await wrangler(['d1', 'delete', databaseName, '--skip-confirmation']);
  } catch (error) {
    console.error(
      `[cleanup] failed to delete ${databaseName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function runCase(
  label: 'legacy' | 'bootstrap',
  repoDir: string,
  databaseName: string,
): Promise<BenchmarkResult> {
  const startedAt = Date.now();
  try {
    await createDatabase(repoDir, databaseName);
    return {
      label,
      databaseName,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    await cleanupDatabase(databaseName);
  }
}

async function main(): Promise<void> {
  const options = parseArgs();
  setAccountId(options.accountId);

  const workspace = join(
    tmpdir(),
    `line-harness-db-benchmark-${Date.now().toString(36)}`,
  );
  mkdirSync(workspace, { recursive: true });

  const legacyRepo = prepareRepoVariant(options.repoSource, workspace, 'legacy');
  const bootstrapRepo = prepareRepoVariant(options.repoSource, workspace, 'bootstrap');

  try {
    const legacyName = `${options.prefix}-legacy`;
    const bootstrapName = `${options.prefix}-bootstrap`;
    const results: Partial<Record<'legacy' | 'bootstrap', BenchmarkResult>> = {};

    if (options.mode === 'legacy' || options.mode === 'both') {
      results.legacy = await runCase('legacy', legacyRepo, legacyName);
    }
    if (options.mode === 'bootstrap' || options.mode === 'both') {
      results.bootstrap = await runCase('bootstrap', bootstrapRepo, bootstrapName);
    }

    const legacy = results.legacy ?? null;
    const bootstrap = results.bootstrap ?? null;
    const savedMs =
      legacy && bootstrap ? legacy.elapsedMs - bootstrap.elapsedMs : null;
    const speedup =
      legacy && bootstrap && legacy.elapsedMs > 0 && bootstrap.elapsedMs > 0
        ? Number((legacy.elapsedMs / bootstrap.elapsedMs).toFixed(2))
        : null;

    console.log(JSON.stringify({ legacy, bootstrap, savedMs, speedup }, null, 2));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
