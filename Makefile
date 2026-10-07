.DEFAULT_GOAL := help

CARGO ?= cargo
MISE ?= mise
PNPM ?= pnpm

CARGO_DENY_VERSION := 0.20.2
CARGO_MACHETE_VERSION := 0.9.2
CARGO_LLVM_COV_VERSION := 0.9.0
CARGO_AUDIT_VERSION := $(shell awk -F'"' '/^"cargo:cargo-audit" = / { print $$4 }' mise.toml)
CARGO_OUTDATED_VERSION := $(shell awk -F'"' '/^"cargo:cargo-outdated" = / { print $$4 }' mise.toml)
TOOLS_ROOT := $(CURDIR)/.bin
TOOLS_BIN := $(TOOLS_ROOT)/bin

NODE_VERSION := $(shell awk -F'"' '/^node = / { print $$2 }' mise.toml)
PNPM_VERSION := $(shell awk -F'"' '/^pnpm = "[0-9]/ { print $$2 }' mise.toml)
RUST_VERSION := $(shell awk -F'"' '/^rust = / { print $$2 }' mise.toml)

RUST_COVERAGE_MIN ?= 87
RUST_COVERAGE_DIFF_MIN ?= 85
DESKTOP_COVERAGE_DIFF_MIN ?= 85
BROWSER_COVERAGE_DIFF_MIN ?= 85
COVERAGE_DIFF_BASE ?=
RUST_LCOV := target/coverage/rust-lcov.info
DESKTOP_LCOV := apps/desktop/coverage/lcov.info
BROWSER_LCOV := apps/browser-extension/coverage/lcov.info
DIFF_BASE_ARGS = $(if $(strip $(COVERAGE_DIFF_BASE)),--base "$(COVERAGE_DIFF_BASE)" --require-base,)

CORE_PACKAGES := -p nian-pass-cli -p kdbx -p vault-core -p vault-session -p vault-sync \
	-p credential-provider-core -p ios-credential-ffi -p browser-native-protocol \
	-p nian-pass-browser-host -p sync-provider-core -p sync-engine \
	-p sync-gateway-protocol -p sync-provider-webdav -p sync-provider-s3 -p sync-provider-gateway \
	-p nian-pass-sync-gateway -p windows-safe-replace

.PHONY: help clean deps-install format format-check test build audit outdated check \
	toolchain-install toolchain-check \
	rust-audit rust-outdated ui-audit ui-outdated \
	tools-install tools-check fixture-check \
	rust-format rust-lint rust-test rust-doc rust-deps-check rust-security-check \
	rust-coverage rust-coverage-check rust-coverage-diff rust-core-check rust-check \
	desktop-install desktop-format desktop-format-check desktop-lint desktop-no-eslint-disable \
	desktop-typecheck desktop-test desktop-test-coverage desktop-coverage-check \
	desktop-coverage-diff desktop-dead-code desktop-build desktop-audit \
	desktop-contract-rust-check desktop-contract-frontend-check desktop-contract-check \
	desktop-native-check desktop-check windows-cross-check \
	browser-install browser-format-check browser-lint browser-typecheck browser-test \
	browser-test-coverage browser-coverage-check browser-coverage-diff browser-dead-code \
	browser-build browser-artifact-check browser-audit browser-source-check browser-extension-check \
	browser-native-protocol-check browser-native-host-check browser-integration-check \
	architecture-check security-check docs-check scripts-install scripts-check mobile-source-check \
	mobile-tools-check mobile-android-check mobile-ios-tools-check mobile-ios-source-check mobile-ios-check \
	compat-check compat-check-required policy-check quick-check quality-check \
	sync-source-check sync-core-check sync-provider-check sync-integration-check \
	gateway-source-check gateway-server-check gateway-provider-check gateway-integration-check \
	gateway-container-check \
	security-hardening-check release-policy-check release-source-check release-source-prebuild-check release-source-postbuild-check node-license-check \
	release-browser-package release-linux-build release-windows-build release-android-build \
	release-gateway-image release-stage release-assemble release-artifact-check release-check

##@ Getting started
help: ## Show the documented Make targets
	@awk 'BEGIN { FS = ":.*##"; printf "Usage: make <target> [VAR=value...]\n" } /^##@/ { if (shown++) printf "\n"; printf "%s\n", substr($$0, 5); next } /^[a-zA-Z0-9_.-]+:.*##/ { printf "  \033[36m%-32s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

deps-install: ## Install all pnpm workspace dependencies from the frozen lockfile
	$(PNPM) install --frozen-lockfile

##@ Tooling and fixtures
toolchain-install: ## Install repository-pinned runtimes and Cargo audit/update tools with mise
	MISE_LOCKED_SCOPES=project $(MISE) install --locked node pnpm rust cargo:cargo-audit cargo:cargo-outdated

toolchain-check: ## Verify Rust, Node, pnpm, cargo-audit, and cargo-outdated match mise pins
	@test "$$($(MISE) exec -- rustc --version | awk '{print $$2}')" = "$(RUST_VERSION)" || { echo "Rust $(RUST_VERSION) is required; run 'make toolchain-install'." >&2; exit 1; }
	@test "$$($(MISE) exec -- node --version)" = "v$(NODE_VERSION)" || { echo "Node $(NODE_VERSION) is required; run 'make toolchain-install'." >&2; exit 1; }
	@test "$$($(MISE) exec -- pnpm --version)" = "$(PNPM_VERSION)" || { echo "pnpm $(PNPM_VERSION) is required; run 'make toolchain-install'." >&2; exit 1; }
	@test "$$($(MISE) exec -- cargo audit --version | awk '{print $$2}')" = "$(CARGO_AUDIT_VERSION)" || { echo "cargo-audit $(CARGO_AUDIT_VERSION) is required; run 'make toolchain-install'." >&2; exit 1; }
	@test "$$($(MISE) exec -- cargo outdated --version | awk '{print $$2}')" = "$(CARGO_OUTDATED_VERSION)" || { echo "cargo-outdated $(CARGO_OUTDATED_VERSION) is required; run 'make toolchain-install'." >&2; exit 1; }
	@printf 'Rust %s; Node %s; pnpm %s; cargo-audit %s; cargo-outdated %s\n' "$(RUST_VERSION)" "$(NODE_VERSION)" "$(PNPM_VERSION)" "$(CARGO_AUDIT_VERSION)" "$(CARGO_OUTDATED_VERSION)"

tools-install: ## Install the pinned local Rust quality tools and components
	@echo "Install pinned Rust quality tools locally..."
	mkdir -p "$(TOOLS_ROOT)"
	cargo install --locked --force --version $(CARGO_DENY_VERSION) --root "$(TOOLS_ROOT)" cargo-deny
	cargo install --locked --force --version $(CARGO_MACHETE_VERSION) --root "$(TOOLS_ROOT)" cargo-machete
	cargo install --locked --force --version $(CARGO_LLVM_COV_VERSION) --root "$(TOOLS_ROOT)" cargo-llvm-cov
	rustup component add llvm-tools-preview rustfmt clippy

tools-check: toolchain-check ## Verify pinned toolchains and local Rust quality tools
	@echo "Check pinned quality toolchain..."
	@test -x "$(TOOLS_BIN)/cargo-deny" || { echo "Missing cargo-deny $(CARGO_DENY_VERSION); run 'make tools-install'." >&2; exit 1; }
	@test -x "$(TOOLS_BIN)/cargo-machete" || { echo "Missing cargo-machete $(CARGO_MACHETE_VERSION); run 'make tools-install'." >&2; exit 1; }
	@test -x "$(TOOLS_BIN)/cargo-llvm-cov" || { echo "Missing cargo-llvm-cov $(CARGO_LLVM_COV_VERSION); run 'make tools-install'." >&2; exit 1; }
	@test "$$($(TOOLS_BIN)/cargo-deny --version | awk '{print $$2}')" = "$(CARGO_DENY_VERSION)"
	@test "$$($(TOOLS_BIN)/cargo-machete --version)" = "$(CARGO_MACHETE_VERSION)"
	@PATH="$(TOOLS_BIN):$$PATH" cargo llvm-cov --version | grep -Fx "cargo-llvm-cov $(CARGO_LLVM_COV_VERSION)"
	@rustup component list --installed | grep -Eq '^llvm-tools(-|$$)'

fixture-check: ## Verify the committed KDBX test fixture checksums
	@echo "Check immutable KDBX fixture integrity..."
	sha256sum --check fixtures/kdbx/SHA256SUMS

##@ Rust workspace
rust-format: ## Check Rust formatting without changing files
	@echo "Check Rust formatting..."
	cargo fmt --check

rust-lint: ## Run workspace Clippy with warnings denied
	@echo "Check Rust lints and warnings..."
	cargo clippy --locked --workspace --all-targets --all-features -- -D warnings

rust-test: ## Run locked Rust workspace tests
	@echo "Run locked Rust workspace tests..."
	cargo test --locked --workspace

rust-doc: ## Build workspace documentation with warnings denied
	@echo "Check Rust documentation warnings..."
	RUSTDOCFLAGS="-D warnings" cargo doc --locked --workspace --all-features --no-deps

rust-deps-check: ## Detect unused Rust dependencies
	@echo "Check unused Rust dependencies..."
	$(TOOLS_BIN)/cargo-machete

rust-security-check: ## Check Rust advisories, licenses, bans, and sources
	@echo "Check Rust advisories, licenses, bans, and sources..."
	$(TOOLS_BIN)/cargo-deny --locked check -D warnings --hide-inclusion-graph

rust-audit: ## Check Cargo.lock against the RustSec advisory database
	$(MISE) exec -- $(CARGO) audit

rust-outdated: ## List newer direct Rust dependencies across workspace members
	$(MISE) exec -- $(CARGO) outdated --workspace --root-deps-only

rust-coverage: ## Generate Rust workspace LCOV coverage
	@echo "Measure Rust workspace coverage..."
	mkdir -p target/coverage
	PATH="$(TOOLS_BIN):$$PATH" cargo llvm-cov --locked --workspace --all-features \
		--lcov --output-path "$(RUST_LCOV)" \
		--ignore-filename-regex 'apps/(desktop/src-tauri/(build.rs|src/main.rs)|sync-gateway/src/main.rs)'

rust-coverage-check: ## Enforce the Rust line coverage threshold
	@echo "Check Rust line coverage ratchet ($(RUST_COVERAGE_MIN)%)..."
	@test -f "$(RUST_LCOV)" || { echo "Missing $(RUST_LCOV); run 'make rust-coverage'." >&2; exit 1; }
	@awk -F: -v min="$(RUST_COVERAGE_MIN)" '/^LF:/{total+=$$2}/^LH:/{hit+=$$2} END { pct=total ? 100*hit/total : 0; printf "Rust line coverage: %.2f%% (%d/%d), threshold %s%%\n", pct, hit, total, min; exit (total == 0 || pct + 0.000001 < min) }' "$(RUST_LCOV)"

rust-coverage-diff: ## Enforce coverage for changed Rust lines
	@echo "Check changed Rust lines ($(RUST_COVERAGE_DIFF_MIN)%)..."
	node scripts/check_diff_coverage.mjs --file "$(RUST_LCOV)" --threshold "$(RUST_COVERAGE_DIFF_MIN)" --path apps --extension rs $(DIFF_BASE_ARGS)
	node scripts/check_diff_coverage.mjs --file "$(RUST_LCOV)" --threshold "$(RUST_COVERAGE_DIFF_MIN)" --path crates --extension rs $(DIFF_BASE_ARGS)

rust-core-check: ## Run CI format, lint, test, and doc checks for core crates
	@echo "Check non-Tauri Rust crates..."
	cargo fmt --check
	cargo clippy --locked --all-targets --all-features $(CORE_PACKAGES) -- -D warnings
	cargo test --locked $(CORE_PACKAGES)
	RUSTDOCFLAGS="-D warnings" cargo doc --locked --all-features --no-deps $(CORE_PACKAGES)

rust-check: ## Run all Rust lint, test, security, and coverage gates
	$(MAKE) rust-format
	$(MAKE) rust-lint
	$(MAKE) rust-test
	$(MAKE) rust-doc
	$(MAKE) rust-deps-check
	$(MAKE) rust-security-check
	$(MAKE) rust-coverage
	$(MAKE) rust-coverage-check
	$(MAKE) rust-coverage-diff

##@ Desktop app
desktop-install: ## Install frozen pnpm workspace dependencies for the desktop app
	@echo "Install desktop dependencies from the frozen lockfile..."
	pnpm install --frozen-lockfile

desktop-format: ## Format desktop frontend sources
	@echo "Format desktop frontend..."
	pnpm --filter @nian-pass/desktop format

desktop-format-check: ## Check desktop frontend formatting
	@echo "Check desktop frontend formatting..."
	pnpm --filter @nian-pass/desktop format:check

desktop-lint: ## Lint desktop frontend sources
	@echo "Check strict typed desktop ESLint policy..."
	pnpm --filter @nian-pass/desktop lint

desktop-no-eslint-disable: ## Reject forbidden eslint-disable comments
	@echo "Check forbidden production eslint-disable comments..."
	node scripts/check_no_eslint_disable.mjs

desktop-typecheck: ## Typecheck the desktop frontend
	@echo "Check strict desktop TypeScript..."
	pnpm --filter @nian-pass/desktop typecheck

desktop-test: ## Run desktop frontend tests
	@echo "Run desktop frontend tests..."
	pnpm --filter @nian-pass/desktop test

desktop-test-coverage: ## Run desktop tests with coverage thresholds
	@echo "Run desktop tests with coverage ratchets..."
	pnpm --filter @nian-pass/desktop test:coverage

desktop-coverage-check: desktop-test-coverage ## Verify desktop coverage output exists
	@test -f "$(DESKTOP_LCOV)" || { echo "Vitest did not produce $(DESKTOP_LCOV)." >&2; exit 1; }

desktop-coverage-diff: ## Enforce coverage for changed desktop frontend lines
	@echo "Check changed desktop TypeScript lines ($(DESKTOP_COVERAGE_DIFF_MIN)%)..."
	node scripts/check_diff_coverage.mjs --file "$(DESKTOP_LCOV)" --threshold "$(DESKTOP_COVERAGE_DIFF_MIN)" --path apps/desktop --extension ts --extension tsx $(DIFF_BASE_ARGS)

desktop-dead-code: ## Check desktop dead code and dependency declarations
	@echo "Check desktop dead code and dependency declarations..."
	pnpm --filter @nian-pass/desktop dead-code

desktop-build: ## Build the desktop frontend
	@echo "Build desktop frontend headlessly..."
	pnpm --filter @nian-pass/desktop build

desktop-audit: ## Audit production pnpm dependencies
	@echo "Check production frontend dependency vulnerabilities..."
	node scripts/run_pnpm_audit.mjs

desktop-contract-rust-check: ## Check the desktop contract through Rust serialization
	@echo "Check committed desktop contract against Rust serialization..."
	cargo test --locked -p nian-pass-desktop committed_contract_fixture

desktop-contract-frontend-check: ## Check desktop runtime contract validation
	@echo "Check committed desktop contract against runtime TypeScript validation..."
	pnpm --filter @nian-pass/desktop exec vitest run src/lib/desktop.test.ts

desktop-contract-check: ## Check desktop contract from Rust and TypeScript
	$(MAKE) desktop-contract-rust-check
	$(MAKE) desktop-contract-frontend-check

desktop-native-check: ## Check the native Tauri crate without launching a GUI
	@echo "Check the native Tauri crate without launching a GUI..."
	cargo check --locked -p nian-pass-desktop
	cargo test --locked -p nian-pass-desktop
	cargo clippy --locked -p nian-pass-desktop --all-targets --all-features -- -D warnings
	RUSTDOCFLAGS="-D warnings" cargo doc --locked -p nian-pass-desktop --all-features --no-deps

desktop-check: ## Run the desktop frontend CI quality gates
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

##@ Browser extension
browser-install: ## Install frozen pnpm workspace dependencies for the extension
	@echo "Install browser extension dependencies from the frozen lockfile..."
	pnpm install --frozen-lockfile

browser-format-check: ## Check browser extension formatting
	@echo "Check browser extension formatting..."
	pnpm --filter @nian-pass/browser-extension format:check

browser-lint: ## Lint browser extension sources
	@echo "Check strict browser extension ESLint policy..."
	pnpm --filter @nian-pass/browser-extension lint

browser-typecheck: ## Typecheck browser extension sources
	@echo "Check strict browser extension TypeScript..."
	pnpm --filter @nian-pass/browser-extension typecheck

browser-test: ## Run browser extension tests
	@echo "Run browser extension tests..."
	pnpm --filter @nian-pass/browser-extension test

browser-test-coverage: ## Run browser extension tests with coverage thresholds
	@echo "Run browser extension coverage ratchets..."
	pnpm --filter @nian-pass/browser-extension test:coverage

browser-coverage-check: browser-test-coverage ## Verify browser coverage output exists
	@test -f "$(BROWSER_LCOV)" || { echo "Vitest did not produce $(BROWSER_LCOV)." >&2; exit 1; }

browser-coverage-diff: ## Enforce coverage for changed browser extension lines
	@echo "Check changed browser extension TypeScript lines ($(BROWSER_COVERAGE_DIFF_MIN)%)..."
	node scripts/check_diff_coverage.mjs --file "$(BROWSER_LCOV)" --threshold "$(BROWSER_COVERAGE_DIFF_MIN)" --path apps/browser-extension --extension ts $(DIFF_BASE_ARGS)

browser-dead-code: ## Check browser extension dead code and dependency declarations
	@echo "Check browser extension dead code and dependency declarations..."
	pnpm --filter @nian-pass/browser-extension dead-code

browser-build: ## Build Chromium and Firefox extension artifacts
	@echo "Build Chromium and Firefox extension artifacts..."
	pnpm --filter @nian-pass/browser-extension build

browser-artifact-check: ## Validate built browser extension artifacts
	@echo "Validate built browser extension artifacts..."
	node scripts/check_browser_extension.mjs --artifacts

browser-audit: ## Audit production pnpm dependencies for the browser extension
	@echo "Check browser extension production dependency vulnerabilities..."
	node scripts/run_pnpm_audit.mjs

browser-source-check: ## Check browser extension source security invariants
	@echo "Check browser extension source security invariants..."
	node scripts/check_browser_extension.mjs --source

browser-extension-check: browser-install ## Run browser extension CI quality gates
	$(MAKE) browser-format-check
	$(MAKE) browser-lint
	$(MAKE) browser-typecheck
	$(MAKE) browser-coverage-check
	$(MAKE) browser-coverage-diff
	$(MAKE) browser-dead-code
	$(MAKE) browser-build
	$(MAKE) browser-artifact-check
	$(MAKE) browser-audit

##@ Sync, gateway, and Windows
browser-native-protocol-check: ## Test the shared browser/native protocol
	@echo "Check the shared browser/native protocol contract and framing..."
	cargo test --locked -p browser-native-protocol
	cargo clippy --locked -p browser-native-protocol --all-targets --all-features -- -D warnings
	RUSTDOCFLAGS="-D warnings" cargo doc --locked -p browser-native-protocol --all-features --no-deps
	pnpm --filter @nian-pass/browser-extension exec vitest run src/native-contract.test.ts src/protocol.test.ts

browser-native-host-check: ## Check native browser host build and protocol
	@echo "Check the real Native Messaging host and local IPC proxy..."
	node scripts/check_browser_native_host.mjs
	cargo test --locked -p nian-pass-browser-host
	cargo clippy --locked -p nian-pass-browser-host --all-targets --all-features -- -D warnings
	RUSTDOCFLAGS="-D warnings" cargo doc --locked -p nian-pass-browser-host --all-features --no-deps

browser-integration-check: browser-install ## Run browser/native integration tests
	$(MAKE) browser-source-check
	$(MAKE) browser-native-protocol-check
	$(MAKE) browser-native-host-check
	pnpm --filter @nian-pass/browser-extension exec vitest run \
		src/background-native.test.ts src/browser-integration.test.ts src/popup.test.ts
	cargo test --locked -p nian-pass-desktop browser_bridge
	cargo test --locked -p nian-pass-desktop browser_vault_session_identity
	cargo test --locked -p nian-pass-desktop browser_final_read

windows-cross-check: ## Cross-compile core Rust crates for Windows
	@echo "Cross-check persistence, browser host, IPC, installer, and desktop for Windows..."
	cargo check --locked --all-targets --target x86_64-pc-windows-gnu \
		-p vault-session -p vault-sync -p windows-safe-replace -p sync-provider-core -p sync-engine \
		-p sync-provider-webdav -p sync-provider-s3 -p browser-native-protocol \
		-p sync-provider-gateway \
		-p nian-pass-browser-host -p nian-pass-desktop

sync-source-check: ## Check sync source security and architecture rules
	@echo "Check M7 sync architecture and secret-persistence invariants..."
	node scripts/check_sync.mjs

sync-core-check: sync-source-check ## Test sync engine and core provider contracts
	@echo "Check provider-independent sync contract and engine..."
	cargo test --locked -p sync-provider-core -p sync-engine
	cargo clippy --locked -p sync-provider-core -p sync-engine --all-targets --all-features -- -D warnings
	RUSTDOCFLAGS="-D warnings" cargo doc --locked -p sync-provider-core -p sync-engine --all-features --no-deps

sync-provider-check: sync-source-check ## Test sync provider contracts
	@echo "Check WebDAV, S3, and gateway conditional transports..."
	cargo test --locked -p sync-provider-webdav -p sync-provider-s3 -p sync-provider-gateway
	cargo clippy --locked -p sync-provider-webdav -p sync-provider-s3 -p sync-provider-gateway --all-targets --all-features -- -D warnings
	RUSTDOCFLAGS="-D warnings" cargo doc --locked -p sync-provider-webdav -p sync-provider-s3 -p sync-provider-gateway --all-features --no-deps

sync-integration-check: ## Run encrypted KDBX sync integration tests
	@echo "Run deterministic loopback provider and crash-recovery integration tests..."
	cargo test --locked -p sync-engine --test sync
	cargo test --locked -p sync-provider-webdav
	cargo test --locked -p sync-provider-s3
	cargo test --locked -p sync-provider-gateway --test sync_integration

gateway-source-check: ## Check gateway source security and architecture rules
	@echo "Check M7.5 gateway architecture and security invariants..."
	node scripts/check_gateway.mjs

gateway-server-check: gateway-source-check ## Test the sync gateway server
	@echo "Check the Linux self-hosted opaque-object gateway..."
	cargo test --locked -p nian-pass-sync-gateway
	cargo clippy --locked -p nian-pass-sync-gateway --all-targets --all-features -- -D warnings
	RUSTDOCFLAGS="-D warnings" cargo doc --locked -p nian-pass-sync-gateway --all-features --no-deps

gateway-provider-check: gateway-source-check ## Test gateway sync provider behavior
	@echo "Check the strict desktop gateway transport..."
	cargo test --locked -p sync-provider-gateway
	cargo clippy --locked -p sync-provider-gateway --all-targets --all-features -- -D warnings
	RUSTDOCFLAGS="-D warnings" cargo doc --locked -p sync-provider-gateway --all-features --no-deps

gateway-integration-check: gateway-source-check ## Run gateway sync integration tests
	@echo "Run real gateway and encrypted KDBX sync-engine integration tests..."
	cargo test --locked -p nian-pass-sync-gateway --test http
	cargo test --locked -p sync-provider-gateway --test sync_integration
	cargo test --locked -p nian-pass-desktop sync::

gateway-container-check: gateway-source-check ## Smoke test the non-root gateway container
	@echo "Run the documented non-root gateway container lifecycle smoke..."
	bash scripts/check_gateway_container.sh
	test ! -e deploy/gateway.env

##@ Release
release-policy-check: ## Check pinned release inputs and dependency policies
	@echo "Check pinned release inputs, versions, dependencies, actions, and containers..."
	node scripts/check_release_source.mjs
	$(MAKE) node-license-check

node-license-check: ## Check production Node dependency licenses
	@echo "Check production Node dependency licenses..."
	pnpm install --frozen-lockfile
	node scripts/check_node_licenses.mjs

security-hardening-check: ## Run security source and dependency policy gates
	$(MAKE) security-check
	$(MAKE) mobile-source-check
	$(MAKE) browser-source-check
	$(MAKE) sync-source-check
	$(MAKE) gateway-source-check
	$(MAKE) release-policy-check

release-source-prebuild-check: ## Require exact tagged source before a release build
	@echo "Require clean, exact tagged source before a native release build..."
	node scripts/check_release_source.mjs --prebuild

release-source-postbuild-check: ## Verify source identity after a release build
	@echo "Verify release identity and reject unexpected post-build source mutations..."
	RELEASE_COMMIT="$(RELEASE_COMMIT)" RELEASE_VERSION="$(RELEASE_VERSION)" node scripts/check_release_source.mjs --postbuild

release-source-check: release-source-prebuild-check ## Run release source prebuild checks

# Capture provenance before any native tool can create generated build state.
# Each release target passes this immutable identity explicitly to its post-build
# verifier instead of reading HEAD or VERSION again after the build.
release-browser-package release-linux-build release-android-build release-gateway-image: private RELEASE_COMMIT := $(shell git rev-parse HEAD)
release-browser-package release-linux-build release-android-build release-gateway-image: private RELEASE_VERSION := $(shell cat VERSION)

release-browser-package: release-source-check ## Build and package the browser extension release
	$(MAKE) browser-build browser-artifact-check
	pnpm --filter @nian-pass/browser-extension package
	RELEASE_COMMIT="$(RELEASE_COMMIT)" RELEASE_VERSION="$(RELEASE_VERSION)" $(MAKE) release-source-postbuild-check

release-linux-build: release-source-check ## Build Linux desktop and native host release artifacts
	pnpm install --frozen-lockfile
	NIAN_PASS_COMMIT="$$(git rev-parse HEAD)" pnpm --filter @nian-pass/desktop tauri build --ci --bundles appimage,deb
	cargo build --locked --release -p nian-pass-browser-host
	node scripts/package_native_host.mjs linux-x86_64 target/release/nian-pass-browser-host
	RELEASE_COMMIT="$(RELEASE_COMMIT)" RELEASE_VERSION="$(RELEASE_VERSION)" $(MAKE) release-stage

release-windows-build: ## Build the Windows desktop release
	pwsh -NoProfile -NonInteractive -File scripts/release_windows.ps1

release-android-build: release-source-check mobile-android-check ## Build the Android release
	RELEASE_COMMIT="$(RELEASE_COMMIT)" RELEASE_VERSION="$(RELEASE_VERSION)" $(MAKE) release-stage

release-gateway-image: release-source-check ## Build and stage the sync gateway image
	@mkdir -p artifacts/release
	docker build --pull=false \
		--build-arg NIAN_PASS_VERSION="$$(cat VERSION)" \
		--build-arg NIAN_PASS_COMMIT="$$(git rev-parse HEAD)" \
		--tag "nian-pass-sync-gateway:$$(cat VERSION)" \
		--file apps/sync-gateway/Dockerfile .
	@docker image inspect --format '{"imageId":"{{.Id}}","repoTags":{{json .RepoTags}}}' \
		"nian-pass-sync-gateway:$$(cat VERSION)" > artifacts/release/gateway-image.json
	@docker image save "nian-pass-sync-gateway:$$(cat VERSION)" | gzip -n \
		> "artifacts/release/nian-pass-sync-gateway-$$(cat VERSION).tar.gz"
	RELEASE_COMMIT="$(RELEASE_COMMIT)" RELEASE_VERSION="$(RELEASE_VERSION)" $(MAKE) release-source-postbuild-check

release-stage: release-source-postbuild-check ## Stage release outputs with provenance metadata
	node scripts/stage_release.mjs

release-assemble: ## Assemble release artifacts into the release directory
	node scripts/assemble_release.mjs

release-artifact-check: release-source-check ## Generate and verify release SBOM and checksums
	node scripts/release_artifacts.mjs scan
	test -s "$${ARTIFACT_DIR:-artifacts/release}/release-status.md"
	node scripts/release_artifacts.mjs sbom
	node scripts/release_artifacts.mjs manifest
	node scripts/release_artifacts.mjs checksums

release-check: release-source-check quality-check gateway-container-check release-browser-package release-artifact-check ## Run the complete release gate

##@ Mobile
mobile-source-check: ## Check mobile source foundations
	@echo "Check deterministic mobile foundation sources..."
	node scripts/check_mobile_foundation.mjs

mobile-tools-check: ## Check Android command-line build prerequisites
	@echo "Check Android CLI build prerequisites..."
	scripts/check_mobile_tools.sh

mobile-android-check: mobile-source-check mobile-tools-check ## Build and verify Android APKs
	@echo "Build the real Tauri Android application as APKs (arm64 + x86_64)..."
	NIAN_PASS_COMMIT="$$(git rev-parse HEAD 2>/dev/null || printf unknown)" pnpm --filter @nian-pass/desktop tauri android build --apk --target aarch64 x86_64 --ci
	@echo "Run focused Android native source tests..."
	apps/desktop/src-tauri/gen/android/gradlew -p apps/desktop/src-tauri/gen/android \
		:app:testUniversalDebugUnitTest :app:compileUniversalDebugAndroidTestKotlin
	@artifact="$$(find apps/desktop/src-tauri/gen/android/app/build/outputs/apk -type f -name '*.apk' -print -quit 2>/dev/null)"; \
		test -n "$$artifact" || { echo "Android build completed without an APK artifact." >&2; exit 1; }; \
		scripts/verify_android_release.sh "$$artifact" && \
		echo "Android APK verified: $$artifact"

mobile-ios-tools-check: ## Check macOS and Xcode prerequisites for iOS builds
	@echo "Check Apple resumption macOS/Xcode iOS build prerequisites..."
	scripts/check_mobile_ios_tools.sh

mobile-ios-source-check: ## Check iOS host and credential provider source contracts
	@echo "Check retained Apple resumption host and Credential Provider sources..."
	node scripts/check_ios_foundation.mjs

mobile-ios-check: mobile-ios-tools-check mobile-ios-source-check ## Build and verify the iOS host and extension
	@echo "Build the Apple resumption Tauri iOS host and embedded Credential Provider Extension..."
	pnpm --filter @nian-pass/desktop tauri ios build --ci
	@artifact="$$(find apps/desktop/src-tauri/gen/apple -type d -name '*.app' -not -path '*/Index.noindex/*' -print -quit 2>/dev/null)"; \
		test -n "$$artifact" || { echo "iOS build completed without an .app artifact." >&2; exit 1; }; \
		scripts/verify_ios_build.sh "$$artifact" && \
		echo "iOS host and Credential Provider verified: $$artifact"

##@ Repository policies and workflows
architecture-check: ## Check architecture boundaries and source line budgets
	@echo "Check architecture boundaries and line budgets..."
	node scripts/check_architecture.mjs

security-check: ## Check desktop and Rust security policies
	@echo "Check desktop/Rust security policy defense-in-depth..."
	node scripts/check_security.mjs

docs-check: ## Check quality and security documentation contracts
	@echo "Check quality and security documentation contracts..."
	node scripts/check_docs.mjs

scripts-install: ## Install locked quality-script dependencies
	@echo "Install locked quality script dependencies..."
	pnpm --filter nian-pass-workspace install --frozen-lockfile

scripts-check: scripts-install ## Check quality scripts syntax and behavior
	@echo "Check quality infrastructure syntax and behavior..."
	@for script in scripts/*.mjs scripts/lib/*.mjs; do node --check "$$script"; done
	@for script in scripts/*.sh; do bash -n "$$script"; done
	node --test "scripts/test/*.test.mjs"

compat-check: ## Run optional external KeePassXC compatibility checks
	@echo "Check external KeePassXC compatibility when available..."
	scripts/test-keepassxc-compat.sh

compat-check-required: ## Require external KeePassXC compatibility checks
	@echo "Require external KeePassXC compatibility..."
	scripts/test-keepassxc-compat.sh --require

ui-audit: ## Audit production dependencies in the pnpm workspace
	node scripts/run_pnpm_audit.mjs

ui-outdated: ## List newer pnpm workspace dependencies
	PNPM="$(PNPM)" node scripts/run_pnpm_outdated.mjs

format: ## Format Rust, desktop, and browser extension sources
	$(CARGO) fmt --all
	$(PNPM) --filter @nian-pass/desktop format
	$(PNPM) --filter @nian-pass/browser-extension format

format-check: ## Check Rust, desktop, and browser extension formatting
	$(MAKE) rust-format
	$(MAKE) desktop-format-check
	$(MAKE) browser-format-check

audit: ## Audit Rust advisories and production pnpm dependencies
	$(MAKE) rust-audit
	$(MAKE) ui-audit

outdated: ## List newer direct Rust and pnpm workspace dependencies
	$(MAKE) rust-outdated
	$(MAKE) ui-outdated

test: ## Run Rust, desktop, and browser extension test suites
	$(MAKE) rust-test
	$(MAKE) desktop-test
	$(MAKE) browser-test

build: ## Build Rust workspace and desktop and browser frontends
	$(CARGO) build --locked --workspace
	$(MAKE) desktop-build
	$(MAKE) browser-build

policy-check: ## Run repository policy and source invariant checks
	$(MAKE) fixture-check
	$(MAKE) scripts-check
	$(MAKE) architecture-check
	$(MAKE) mobile-source-check
	$(MAKE) security-check
	$(MAKE) docs-check
	$(MAKE) sync-source-check
	$(MAKE) gateway-source-check
	$(MAKE) release-policy-check

quick-check: ## Run the fast local checks used during development
	$(MAKE) fixture-check
	$(MAKE) scripts-check
	$(MAKE) architecture-check
	$(MAKE) mobile-source-check
	$(MAKE) rust-format
	$(MAKE) rust-lint
	$(MAKE) rust-test
	$(MAKE) sync-core-check
	$(MAKE) sync-provider-check
	$(MAKE) gateway-server-check
	$(MAKE) gateway-provider-check
	$(MAKE) gateway-integration-check
	$(MAKE) desktop-format-check
	$(MAKE) desktop-lint
	$(MAKE) desktop-no-eslint-disable
	$(MAKE) desktop-typecheck
	$(MAKE) desktop-test
	$(MAKE) browser-source-check
	$(MAKE) browser-extension-check
	$(MAKE) browser-integration-check
	$(MAKE) security-check
	$(MAKE) docs-check

quality-check: ## Run the full Linux CI quality gate
	$(MAKE) tools-check
	$(MAKE) fixture-check
	$(MAKE) scripts-check
	$(MAKE) architecture-check
	$(MAKE) mobile-source-check
	$(MAKE) rust-check
	$(MAKE) sync-core-check
	$(MAKE) sync-provider-check
	$(MAKE) sync-integration-check
	$(MAKE) gateway-server-check
	$(MAKE) gateway-provider-check
	$(MAKE) gateway-integration-check
	$(MAKE) desktop-check
	$(MAKE) browser-source-check
	$(MAKE) browser-extension-check
	$(MAKE) browser-integration-check
	$(MAKE) security-check
	$(MAKE) docs-check
	$(MAKE) compat-check

check: quality-check ## Alias for the full CI quality gate

##@ Cleanup
clean: ## Remove Cargo and frontend build and coverage outputs
	$(CARGO) clean
	rm -rf apps/desktop/dist apps/desktop/coverage apps/browser-extension/dist apps/browser-extension/coverage
