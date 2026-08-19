import * as p from "@clack/prompts";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { wrangler, WranglerError } from "../lib/wrangler.js";

interface DatabaseResult {
  databaseId: string;
  databaseName: string;
}

interface BootstrapMeta {
  includedMigrations: string[];
  migrationCount: number;
}

const TRANSIENT_D1_ERROR = /code[:\s]*10043|cloudflarestatus|temporarily unavailable|internal error|timed out|timeout|fetch failed|network|connection reset/i;
const D1_RETRY_ATTEMPTS = 3;

function isTransientD1Error(err: unknown): boolean {
  if (!(err instanceof WranglerError)) return false;
  const text = `${err.message}\n${err.stderr}`;
  return TRANSIENT_D1_ERROR.test(text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runD1WithRetry(
  args: string[],
  contextLabel: string,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= D1_RETRY_ATTEMPTS; attempt++) {
    try {
      return await wrangler(args);
    } catch (err) {
      lastErr = err;
      if (!isTransientD1Error(err) || attempt === D1_RETRY_ATTEMPTS) {
        throw err;
      }
      p.log.warn(
        `${contextLabel}: Cloudflare D1 の一時エラーのため再試行します (${attempt}/${D1_RETRY_ATTEMPTS})...`,
      );
      await sleep(attempt * 2_000);
    }
  }
  throw lastErr;
}

const isBenignSchemaError = (err: unknown): boolean => {
  if (!(err instanceof WranglerError)) return false;
  const text = `${err.message}\n${err.stderr}`.toLowerCase();
  return (
    text.includes("duplicate column") ||
    text.includes("already exists") ||
    text.includes("table") && text.includes("already")
  );
};

async function verifyLatestSchema(databaseName: string): Promise<void> {
  const verify = await runD1WithRetry(
    [
      "d1",
      "execute",
      databaseName,
      "--remote",
      "--command",
      "SELECT name FROM sqlite_master WHERE type='table' AND name='line_accounts'",
    ],
    "テーブル検証",
  );

  if (!verify.includes("line_accounts")) {
    throw new Error(
      "schema/bootstrap を適用したのに line_accounts テーブルが見当たりません。`packages/db/bootstrap.sql` または migration 適用に問題があります。",
    );
  }
}

function loadBootstrapMeta(repoDir: string): BootstrapMeta | null {
  const metaPath = join(repoDir, "packages/db/bootstrap-meta.json");
  if (!existsSync(metaPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(metaPath, "utf8")) as BootstrapMeta;
    if (
      typeof parsed.migrationCount !== "number" ||
      !Array.isArray(parsed.includedMigrations) ||
      !parsed.includedMigrations.every((value) => typeof value === "string")
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function createDatabase(
  repoDir: string,
  databaseName: string,
): Promise<DatabaseResult> {
  const s = p.spinner();

  // Create D1 database — keep this in pipe mode so we can parse the ID and
  // detect the "already exists" case via captured stderr.
  s.start("D1 データベース作成中...");
  let databaseId: string;
  let createdNow = false;
  try {
    const output = await runD1WithRetry(
      ["d1", "create", databaseName],
      "D1 データベース作成",
    );
    // Parse database_id from TOML or JSON format
    const tomlMatch = output.match(/database_id\s*=\s*"([^"]+)"/);
    const jsonMatch = output.match(/"database_id"\s*:\s*"([^"]+)"/);
    const uuidMatch = output.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    );
    const match = tomlMatch || jsonMatch || uuidMatch;
    if (!match) {
      throw new Error(`D1 ID をパースできません: ${output}`);
    }
    databaseId = match[1];
    createdNow = true;
    s.stop("D1 データベース作成完了");
  } catch (error) {
    if (
      error instanceof WranglerError &&
      error.stderr.includes("already exists")
    ) {
      s.stop("D1 データベースは既に存在します");
      const listOutput = await runD1WithRetry(
        ["d1", "list", "--json"],
        "D1 一覧取得",
      );
      const databases = JSON.parse(listOutput);
      const db = databases.find(
        (d: { name: string }) => d.name === databaseName,
      );
      if (!db) {
        throw new Error("既存の D1 データベースが見つかりません");
      }
      databaseId = db.uuid;
    } else {
      s.stop("D1 データベース作成失敗");
      throw error;
    }
  }

  const bootstrapFile = join(repoDir, "packages/db/bootstrap.sql");
  const schemaFile = join(repoDir, "packages/db/schema.sql");
  const migrationsDir = join(repoDir, "packages/db/migrations");
  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const bootstrapMeta = loadBootstrapMeta(repoDir);
  const includedMigrations = new Set(bootstrapMeta?.includedMigrations ?? []);
  const canUseBootstrap =
    createdNow &&
    existsSync(bootstrapFile) &&
    bootstrapMeta !== null &&
    bootstrapMeta.includedMigrations.every((file) => migrationFiles.includes(file));

  if (canUseBootstrap) {
    const pendingMigrations = migrationFiles.filter(
      (file) => !includedMigrations.has(file),
    );
    const label =
      pendingMigrations.length === 0
        ? "テーブル作成中（bootstrap）..."
        : `テーブル作成中（bootstrap + ${pendingMigrations.length} migrations）...`;
    s.start(label);
    try {
      await runD1WithRetry(
        [
          "d1",
          "execute",
          databaseName,
          "--remote",
          "--file",
          bootstrapFile,
        ],
        "bootstrap 適用",
      );
    } catch (err) {
      if (!isBenignSchemaError(err)) {
        s.stop("bootstrap 適用に失敗");
        throw err;
      }
    }

    for (const file of pendingMigrations) {
      try {
        await runD1WithRetry(
          [
            "d1",
            "execute",
            databaseName,
            "--remote",
            "--file",
            join(migrationsDir, file),
          ],
          `bootstrap 後 migration 適用: ${file}`,
        );
      } catch (err) {
        if (!isBenignSchemaError(err)) {
          s.stop(`migration 失敗: ${file}`);
          throw err;
        }
      }
    }
  } else {
    const totalFiles = 1 + migrationFiles.length;
    s.start(`テーブル作成中（${totalFiles} files）...`);

    try {
      await runD1WithRetry(
        [
          "d1",
          "execute",
          databaseName,
          "--remote",
          "--file",
          schemaFile,
        ],
        "ベーススキーマ適用",
      );
    } catch (err) {
      if (!isBenignSchemaError(err)) {
        s.stop("ベーススキーマ適用に失敗");
        throw err;
      }
    }

    for (const file of migrationFiles) {
      try {
        await runD1WithRetry(
          [
            "d1",
            "execute",
            databaseName,
            "--remote",
            "--file",
            join(migrationsDir, file),
          ],
          `migration 適用: ${file}`,
        );
      } catch (err) {
        if (!isBenignSchemaError(err)) {
          s.stop(`migration 失敗: ${file}`);
          throw err;
        }
      }
    }
  }

  try {
    await verifyLatestSchema(databaseName);
  } catch (err) {
      s.stop("テーブル検証失敗");
    throw err;
  }

  s.stop("テーブル作成完了");

  return { databaseId, databaseName };
}
