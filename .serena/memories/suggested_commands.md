# Common commands

- `rtk make toolchain-install` — install the five repository-pinned runtimes and Mise-managed Cargo audit/update tools from `mise.toml` and `mise.lock`; it names those project tools explicitly and scopes locked mode to the project so inherited global tools do not trigger lockfile warnings.
- `rtk make toolchain-check` — verify the active toolchain versions against those pins.
- `rtk make quick-check` — broad local headless checks.
- `rtk make quality-check` — canonical full Linux quality gate; `rtk make check` is its short alias.
- `rtk make` or `rtk make help` — list the categorized commands (help is the default Make target).
- `rtk make format` / `format-check` — format or check Rust, desktop, and browser extension sources.
- `rtk make test`, `build`, and `audit` — run the common cross-workspace workflows; `outdated` checks Cargo workspace root dependencies and all pnpm workspace packages recursively.
- `rtk make policy-check` — fixtures, scripts, architecture, mobile source, security, docs, sync, gateway, and release policy.
- Focused targets include `rtk make docs-check`, `rtk make scripts-check`, `rtk make rust-core-check`, `rtk make sync-source-check`, and `rtk make gateway-source-check`.
- When changing `mise.toml`, regenerate the lockfile with `rtk mise lock`; do not hand-edit `mise.lock`.
- Use Serena semantic tools before exact text searches. After changes, run `rtk git diff --check` and the narrow relevant policy gate.
- `rtk make clean` removes Cargo and frontend build/coverage outputs while preserving installed tools and staged release artifacts.