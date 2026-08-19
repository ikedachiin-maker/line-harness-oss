# create-line-harness Sandbox Runner

`create-line-harness` writes state into `~/.line-harness`, reads wrangler auth from your home/XDG config, and clones the OSS repo into a canonical location. When you want to reproduce installer bugs on the same MacBook without contaminating your normal setup, run the CLI inside a relocated `HOME`.

This repo now includes [`scripts/run-create-line-harness-sandbox.sh`](/Users/axpr/claudecode/tools/line-harness/scripts/run-create-line-harness-sandbox.sh), which creates an isolated shell rooted under `/private/tmp/line-harness-sandboxes/<name>`.

## What it isolates

- `~/.line-harness` clone and `.line-harness-setup.json`
- wrangler config/cache under `HOME` and `XDG_*`
- npm user config, npm cache, pnpm home, corepack cache
- the working directory from which `npx create-line-harness` is launched

## What it does not isolate

- Cloudflare resources created by the account/token you use inside the sandbox
- LINE Developers resources you point the setup at
- npm publishes or any other action performed with credentials you explicitly reuse

Local isolation prevents the installer from touching your real `~/.line-harness` and wrangler session files. It does **not** make Cloudflare deploys harmless by itself. For a true repro lane, combine the sandbox with:

- a separate Cloudflare account when possible
- otherwise a unique project name such as `lh-sbx-20260521`
- a dedicated test LINE bot / LIFF app

## Quick start

Run the published npm package in a clean sandbox:

```bash
cd /Users/axpr/claudecode/tools/line-harness
./scripts/run-create-line-harness-sandbox.sh --name repro-20260521 -- npx create-line-harness
```

Open an interactive shell first, while reusing your current wrangler login:

```bash
cd /Users/axpr/claudecode/tools/line-harness
./scripts/run-create-line-harness-sandbox.sh --name repro-20260521 --reuse-wrangler-auth
```

Inside that shell you can then run:

```bash
npx wrangler whoami
npx create-line-harness
```

Reset the sandbox and start over from scratch:

```bash
cd /Users/axpr/claudecode/tools/line-harness
./scripts/run-create-line-harness-sandbox.sh --name repro-20260521 --reset -- npx create-line-harness
```

## Practical workflow for installer debugging

1. Launch a fresh sandbox with `--reset`.
2. Use a unique project name so Worker, D1, R2, and Pages resources do not collide with production.
3. Prefer a test LINE channel and test LIFF app.
4. After the run, inspect only the sandbox copy:
   - `$LINE_HARNESS_SANDBOX_ROOT/home/.line-harness`
   - `$LINE_HARNESS_SANDBOX_ROOT/home/.line-harness/.line-harness-setup.json`
   - `$LINE_HARNESS_SANDBOX_ROOT/home/.line-harness/apps/worker/wrangler.toml`
5. Throw the whole sandbox away with `--reset` or `rm -rf /private/tmp/line-harness-sandboxes/<name>`.

## Why this helps with the current 0.1.20 issues

The 0.1.20 setup bugs you found mix together:

- installer state written into `~/.line-harness`
- wrangler auth behavior depending on TTY and home-directory config
- Cloudflare resources whose names persist after a failed run

Relocating `HOME` gives you deterministic local state for each repro attempt, which makes it much easier to confirm whether a fix really changes:

- the final `apps/worker/wrangler.toml`
- the contents of `.line-harness-setup.json`
- whether `wrangler whoami`, `pages deploy`, and resume behavior still depend on stale local files
