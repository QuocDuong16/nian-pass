# Tech stack

- Rust 2024 workspace: reusable domain/persistence/sync crates plus Tauri desktop, CLI, Native Messaging host, and Linux sync gateway.
- Desktop: Tauri 2 with React/TypeScript, Vite, pnpm; Node scripts enforce architecture, security, release, and documentation policy.
- Mobile host code includes generated Tauri Android/Kotlin integration and retained iOS/Swift FFI foundations.
- Forgejo is the canonical quality CI; GitHub workflows cover release and Windows diagnostics. Docker builds the self-hosted gateway.
- `mise.toml` is the toolchain source of truth; `mise.lock` locks tool metadata. Rustup, Cargo MSRV, `.node-version`, package engines, containers, and CI values are checked mirrors.
- Serena project servers: TypeScript, Rust, and Bash, indexed from the repository root.