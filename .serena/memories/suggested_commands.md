# Common commands

- `mise install` — install repository-pinned Rust and Node tools from `mise.toml` and `mise.lock`.
- `rtk make quick-check` — broad local headless checks.
- `rtk make quality-check` — canonical full Linux quality gate.
- `rtk make policy-check` — fixtures, scripts, architecture, mobile source, security, docs, sync, gateway, and release policy.
- Focused targets include `rtk make docs-check`, `rtk make scripts-check`, `rtk make rust-core-check`, `rtk make sync-source-check`, and `rtk make gateway-source-check`.
- When changing `mise.toml`, regenerate the lockfile with `rtk mise lock`; do not hand-edit `mise.lock`.
- Use Serena semantic tools before exact text searches. After changes, run `rtk git diff --check` and the narrow relevant policy gate.