CARGO_DENY_VERSION := 0.20.2
CARGO_MACHETE_VERSION := 0.9.2
CARGO_LLVM_COV_VERSION := 0.9.0
TOOLS_ROOT := $(CURDIR)/.bin
TOOLS_BIN := $(TOOLS_ROOT)/bin

NODE_VERSION := $(shell tr -d '\r\n' < .node-version)
PNPM_VERSION := $(shell node -p "require('./package.json').packageManager.split('@')[1]")
RUST_VERSION := $(shell awk -F'"' '/^rust = / { print $$2 }' .mise.toml)

RUST_COVERAGE_MIN ?= 87
RUST_COVERAGE_DIFF_MIN ?= 85
DESKTOP_COVERAGE_DIFF_MIN ?= 85
COVERAGE_DIFF_BASE ?=
RUST_LCOV := target/coverage/rust-lcov.info
DESKTOP_LCOV := apps/desktop/coverage/lcov.info
DIFF_BASE_ARGS = $(if $(strip $(COVERAGE_DIFF_BASE)),--base "$(COVERAGE_DIFF_BASE)" --require-base,)

CORE_PACKAGES := -p nian-pass-cli -p kdbx -p vault-core -p vault-session -p vault-sync \
	-p credential-provider-core -p ios-credential-ffi

.PHONY: tools-install tools-check fixture-check \
	rust-format rust-lint rust-test rust-doc rust-deps-check rust-security-check \
	rust-coverage rust-coverage-check rust-coverage-diff rust-core-check rust-check \
	desktop-install desktop-format desktop-format-check desktop-lint desktop-no-eslint-disable \
	desktop-typecheck desktop-test desktop-test-coverage desktop-coverage-check \
	desktop-coverage-diff desktop-dead-code desktop-build desktop-audit \
	desktop-contract-rust-check desktop-contract-frontend-check desktop-contract-check \
	desktop-native-check desktop-check windows-cross-check \
	architecture-check security-check docs-check scripts-install scripts-check mobile-source-check \
	mobile-tools-check mobile-android-check mobile-ios-tools-check mobile-ios-source-check mobile-ios-check \
	compat-check compat-check-required policy-check quick-check quality-check

tools-install:
	@echo "Install pinned Rust quality tools locally..."
	mkdir -p "$(TOOLS_ROOT)"
	cargo install --locked --force --version $(CARGO_DENY_VERSION) --root "$(TOOLS_ROOT)" cargo-deny
	cargo install --locked --force --version $(CARGO_MACHETE_VERSION) --root "$(TOOLS_ROOT)" cargo-machete
	cargo install --locked --force --version $(CARGO_LLVM_COV_VERSION) --root "$(TOOLS_ROOT)" cargo-llvm-cov
	rustup component add llvm-tools-preview rustfmt clippy

tools-check:
	@echo "Check pinned quality toolchain..."
	@test "$$(rustc --version | awk '{print $$2}')" = "$(RUST_VERSION)" || { echo "Rust $(RUST_VERSION) is required (see rust-toolchain policy in docs/quality.md)." >&2; exit 1; }
	@test "$$(node --version)" = "v$(NODE_VERSION)" || { echo "Node $(NODE_VERSION) is required; current: $$(node --version)." >&2; exit 1; }
	@test "$$(pnpm --version)" = "$(PNPM_VERSION)" || { echo "pnpm $(PNPM_VERSION) is required; activate the root packageManager version with Corepack." >&2; exit 1; }
	@test -x "$(TOOLS_BIN)/cargo-deny" || { echo "Missing cargo-deny $(CARGO_DENY_VERSION); run 'make tools-install'." >&2; exit 1; }
	@test -x "$(TOOLS_BIN)/cargo-machete" || { echo "Missing cargo-machete $(CARGO_MACHETE_VERSION); run 'make tools-install'." >&2; exit 1; }
	@test -x "$(TOOLS_BIN)/cargo-llvm-cov" || { echo "Missing cargo-llvm-cov $(CARGO_LLVM_COV_VERSION); run 'make tools-install'." >&2; exit 1; }
	@test "$$($(TOOLS_BIN)/cargo-deny --version | awk '{print $$2}')" = "$(CARGO_DENY_VERSION)"
	@test "$$($(TOOLS_BIN)/cargo-machete --version)" = "$(CARGO_MACHETE_VERSION)"
	@PATH="$(TOOLS_BIN):$$PATH" cargo llvm-cov --version | grep -Fx "cargo-llvm-cov $(CARGO_LLVM_COV_VERSION)"
	@rustup component list --installed | grep -Eq '^llvm-tools(-|$$)'

fixture-check:
	@echo "Check immutable KDBX fixture integrity..."
	sha256sum --check fixtures/kdbx/SHA256SUMS

rust-format:
	@echo "Check Rust formatting..."
	cargo fmt --check

rust-lint:
	@echo "Check Rust lints and warnings..."
	cargo clippy --locked --workspace --all-targets --all-features -- -D warnings

rust-test:
	@echo "Run locked Rust workspace tests..."
	cargo test --locked --workspace

rust-doc:
	@echo "Check Rust documentation warnings..."
	RUSTDOCFLAGS="-D warnings" cargo doc --locked --workspace --all-features --no-deps

rust-deps-check:
	@echo "Check unused Rust dependencies..."
	$(TOOLS_BIN)/cargo-machete

rust-security-check:
	@echo "Check Rust advisories, licenses, bans, and sources..."
	$(TOOLS_BIN)/cargo-deny check --hide-inclusion-graph

rust-coverage:
	@echo "Measure Rust workspace coverage..."
	mkdir -p target/coverage
	PATH="$(TOOLS_BIN):$$PATH" cargo llvm-cov --locked --workspace --all-features \
		--lcov --output-path "$(RUST_LCOV)" \
		--ignore-filename-regex 'apps/desktop/src-tauri/(build.rs|src/main.rs)'

rust-coverage-check:
	@echo "Check Rust line coverage ratchet ($(RUST_COVERAGE_MIN)%)..."
	@test -f "$(RUST_LCOV)" || { echo "Missing $(RUST_LCOV); run 'make rust-coverage'." >&2; exit 1; }
	@awk -F: -v min="$(RUST_COVERAGE_MIN)" '/^LF:/{total+=$$2}/^LH:/{hit+=$$2} END { pct=total ? 100*hit/total : 0; printf "Rust line coverage: %.2f%% (%d/%d), threshold %s%%\n", pct, hit, total, min; exit (total == 0 || pct + 0.000001 < min) }' "$(RUST_LCOV)"

rust-coverage-diff:
	@echo "Check changed Rust lines ($(RUST_COVERAGE_DIFF_MIN)%)..."
	node scripts/check_diff_coverage.mjs --file "$(RUST_LCOV)" --threshold "$(RUST_COVERAGE_DIFF_MIN)" --path apps --extension rs $(DIFF_BASE_ARGS)
	node scripts/check_diff_coverage.mjs --file "$(RUST_LCOV)" --threshold "$(RUST_COVERAGE_DIFF_MIN)" --path crates --extension rs $(DIFF_BASE_ARGS)

rust-core-check:
	@echo "Check non-Tauri Rust crates..."
	cargo fmt --check
	cargo clippy --locked --all-targets --all-features $(CORE_PACKAGES) -- -D warnings
	cargo test --locked $(CORE_PACKAGES)
	RUSTDOCFLAGS="-D warnings" cargo doc --locked --all-features --no-deps $(CORE_PACKAGES)

rust-check:
	$(MAKE) rust-format
	$(MAKE) rust-lint
	$(MAKE) rust-test
	$(MAKE) rust-doc
	$(MAKE) rust-deps-check
	$(MAKE) rust-security-check
	$(MAKE) rust-coverage
	$(MAKE) rust-coverage-check
	$(MAKE) rust-coverage-diff

desktop-install:
	@echo "Install desktop dependencies from the frozen lockfile..."
	pnpm install --frozen-lockfile

desktop-format:
	@echo "Format desktop frontend..."
	pnpm --filter @nian-pass/desktop format

desktop-format-check:
	@echo "Check desktop frontend formatting..."
	pnpm --filter @nian-pass/desktop format:check

desktop-lint:
	@echo "Check strict typed desktop ESLint policy..."
	pnpm --filter @nian-pass/desktop lint

desktop-no-eslint-disable:
	@echo "Check forbidden production eslint-disable comments..."
	node scripts/check_no_eslint_disable.mjs

desktop-typecheck:
	@echo "Check strict desktop TypeScript..."
	pnpm --filter @nian-pass/desktop typecheck

desktop-test:
	@echo "Run desktop frontend tests..."
	pnpm --filter @nian-pass/desktop test

desktop-test-coverage:
	@echo "Run desktop tests with coverage ratchets..."
	pnpm --filter @nian-pass/desktop test:coverage

desktop-coverage-check: desktop-test-coverage
	@test -f "$(DESKTOP_LCOV)" || { echo "Vitest did not produce $(DESKTOP_LCOV)." >&2; exit 1; }

desktop-coverage-diff:
	@echo "Check changed desktop TypeScript lines ($(DESKTOP_COVERAGE_DIFF_MIN)%)..."
	node scripts/check_diff_coverage.mjs --file "$(DESKTOP_LCOV)" --threshold "$(DESKTOP_COVERAGE_DIFF_MIN)" --path apps/desktop --extension ts --extension tsx $(DIFF_BASE_ARGS)

desktop-dead-code:
	@echo "Check desktop dead code and dependency declarations..."
	pnpm --filter @nian-pass/desktop dead-code

desktop-build:
	@echo "Build desktop frontend headlessly..."
	pnpm --filter @nian-pass/desktop build

desktop-audit:
	@echo "Check production frontend dependency vulnerabilities..."
	pnpm audit --prod

desktop-contract-rust-check:
	@echo "Check committed desktop contract against Rust serialization..."
	cargo test --locked -p nian-pass-desktop committed_contract_fixture

desktop-contract-frontend-check:
	@echo "Check committed desktop contract against runtime TypeScript validation..."
	pnpm --filter @nian-pass/desktop exec vitest run src/lib/desktop.test.ts

desktop-contract-check:
	$(MAKE) desktop-contract-rust-check
	$(MAKE) desktop-contract-frontend-check

desktop-native-check:
	@echo "Check the native Tauri crate without launching a GUI..."
	cargo check --locked -p nian-pass-desktop
	cargo test --locked -p nian-pass-desktop
	cargo clippy --locked -p nian-pass-desktop --all-targets --all-features -- -D warnings
	RUSTDOCFLAGS="-D warnings" cargo doc --locked -p nian-pass-desktop --all-features --no-deps

desktop-check:
	$(MAKE) desktop-install
	$(MAKE) desktop-format-check
	$(MAKE) desktop-lint
	$(MAKE) desktop-no-eslint-disable
	$(MAKE) desktop-typecheck
	$(MAKE) desktop-coverage-check
	$(MAKE) desktop-coverage-diff
	$(MAKE) desktop-dead-code
	$(MAKE) desktop-contract-frontend-check
	$(MAKE) desktop-build
	$(MAKE) desktop-audit

windows-cross-check:
	@echo "Cross-check persistence and sync crates for Windows..."
	cargo check --locked --all-targets --target x86_64-pc-windows-gnu -p vault-session -p vault-sync

mobile-source-check:
	@echo "Check deterministic mobile foundation sources..."
	node scripts/check_mobile_foundation.mjs

mobile-tools-check:
	@echo "Check Android CLI build prerequisites..."
	scripts/check_mobile_tools.sh

mobile-android-check: mobile-source-check mobile-tools-check
	@echo "Build the real Tauri Android application as APKs (arm64 + x86_64)..."
	pnpm --filter @nian-pass/desktop tauri android build --apk --target aarch64 x86_64 --ci
	@echo "Run focused Android native source tests..."
	apps/desktop/src-tauri/gen/android/gradlew -p apps/desktop/src-tauri/gen/android \
		:app:testUniversalDebugUnitTest :app:compileUniversalDebugAndroidTestKotlin
	@artifact="$$(find apps/desktop/src-tauri/gen/android/app/build/outputs/apk -type f -name '*.apk' -print -quit 2>/dev/null)"; \
		test -n "$$artifact" || { echo "Android build completed without an APK artifact." >&2; exit 1; }; \
		scripts/verify_android_release.sh "$$artifact" && \
		echo "Android APK verified: $$artifact"

mobile-ios-tools-check:
	@echo "Check macOS/Xcode iOS build prerequisites..."
	scripts/check_mobile_ios_tools.sh

mobile-ios-source-check:
	@echo "Check deterministic iOS host and Credential Provider sources..."
	node scripts/check_ios_foundation.mjs

mobile-ios-check: mobile-ios-tools-check mobile-ios-source-check
	@echo "Build the actual Tauri iOS host and embedded Credential Provider Extension..."
	pnpm --filter @nian-pass/desktop tauri ios build --ci
	@artifact="$$(find apps/desktop/src-tauri/gen/apple -type d -name '*.app' -not -path '*/Index.noindex/*' -print -quit 2>/dev/null)"; \
		test -n "$$artifact" || { echo "iOS build completed without an .app artifact." >&2; exit 1; }; \
		scripts/verify_ios_build.sh "$$artifact" && \
		echo "iOS host and Credential Provider verified: $$artifact"

architecture-check:
	@echo "Check architecture boundaries and line budgets..."
	node scripts/check_architecture.mjs

security-check:
	@echo "Check desktop/Rust security policy defense-in-depth..."
	node scripts/check_security.mjs

docs-check:
	@echo "Check quality and security documentation contracts..."
	node scripts/check_docs.mjs

scripts-install:
	@echo "Install locked quality script dependencies..."
	pnpm --filter nian-pass-workspace install --frozen-lockfile

scripts-check: scripts-install
	@echo "Check quality infrastructure syntax and behavior..."
	@for script in scripts/*.mjs scripts/lib/*.mjs; do node --check "$$script"; done
	@for script in scripts/*.sh; do bash -n "$$script"; done
	node --test "scripts/test/*.test.mjs"

compat-check:
	@echo "Check external KeePassXC compatibility when available..."
	scripts/test-keepassxc-compat.sh

compat-check-required:
	@echo "Require external KeePassXC compatibility..."
	scripts/test-keepassxc-compat.sh --require

policy-check:
	$(MAKE) fixture-check
	$(MAKE) scripts-check
	$(MAKE) architecture-check
	$(MAKE) mobile-source-check
	$(MAKE) security-check
	$(MAKE) docs-check

quick-check:
	$(MAKE) fixture-check
	$(MAKE) scripts-check
	$(MAKE) architecture-check
	$(MAKE) mobile-source-check
	$(MAKE) rust-format
	$(MAKE) rust-lint
	$(MAKE) rust-test
	$(MAKE) desktop-format-check
	$(MAKE) desktop-lint
	$(MAKE) desktop-no-eslint-disable
	$(MAKE) desktop-typecheck
	$(MAKE) desktop-test
	$(MAKE) security-check
	$(MAKE) docs-check

quality-check:
	$(MAKE) tools-check
	$(MAKE) fixture-check
	$(MAKE) scripts-check
	$(MAKE) architecture-check
	$(MAKE) mobile-source-check
	$(MAKE) rust-check
	$(MAKE) desktop-check
	$(MAKE) security-check
	$(MAKE) docs-check
	$(MAKE) compat-check
