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

.PHONY: tools-install tools-check fixture-check \
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
		--ignore-filename-regex 'apps/(desktop/src-tauri/(build.rs|src/main.rs)|sync-gateway/src/main.rs)'

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
	node scripts/run_pnpm_audit.mjs

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

browser-install:
	@echo "Install browser extension dependencies from the frozen lockfile..."
	pnpm install --frozen-lockfile

browser-format-check:
	@echo "Check browser extension formatting..."
	pnpm --filter @nian-pass/browser-extension format:check

browser-lint:
	@echo "Check strict browser extension ESLint policy..."
	pnpm --filter @nian-pass/browser-extension lint

browser-typecheck:
	@echo "Check strict browser extension TypeScript..."
	pnpm --filter @nian-pass/browser-extension typecheck

browser-test:
	@echo "Run browser extension tests..."
	pnpm --filter @nian-pass/browser-extension test

browser-test-coverage:
	@echo "Run browser extension coverage ratchets..."
	pnpm --filter @nian-pass/browser-extension test:coverage

browser-coverage-check: browser-test-coverage
	@test -f "$(BROWSER_LCOV)" || { echo "Vitest did not produce $(BROWSER_LCOV)." >&2; exit 1; }

browser-coverage-diff:
	@echo "Check changed browser extension TypeScript lines ($(BROWSER_COVERAGE_DIFF_MIN)%)..."
	node scripts/check_diff_coverage.mjs --file "$(BROWSER_LCOV)" --threshold "$(BROWSER_COVERAGE_DIFF_MIN)" --path apps/browser-extension --extension ts $(DIFF_BASE_ARGS)

browser-dead-code:
	@echo "Check browser extension dead code and dependency declarations..."
	pnpm --filter @nian-pass/browser-extension dead-code

browser-build:
	@echo "Build Chromium and Firefox extension artifacts..."
	pnpm --filter @nian-pass/browser-extension build

browser-artifact-check:
	@echo "Validate built browser extension artifacts..."
	node scripts/check_browser_extension.mjs --artifacts

browser-audit:
	@echo "Check browser extension production dependency vulnerabilities..."
	node scripts/run_pnpm_audit.mjs

browser-source-check:
	@echo "Check browser extension source security invariants..."
	node scripts/check_browser_extension.mjs --source

browser-extension-check: browser-install
	$(MAKE) browser-format-check
	$(MAKE) browser-lint
	$(MAKE) browser-typecheck
	$(MAKE) browser-coverage-check
	$(MAKE) browser-coverage-diff
	$(MAKE) browser-dead-code
	$(MAKE) browser-build
	$(MAKE) browser-artifact-check
	$(MAKE) browser-audit

browser-native-protocol-check:
	@echo "Check the shared browser/native protocol contract and framing..."
	cargo test --locked -p browser-native-protocol
	cargo clippy --locked -p browser-native-protocol --all-targets --all-features -- -D warnings
	RUSTDOCFLAGS="-D warnings" cargo doc --locked -p browser-native-protocol --all-features --no-deps
	pnpm --filter @nian-pass/browser-extension exec vitest run src/native-contract.test.ts src/protocol.test.ts

browser-native-host-check:
	@echo "Check the real Native Messaging host and local IPC proxy..."
	node scripts/check_browser_native_host.mjs
	cargo test --locked -p nian-pass-browser-host
	cargo clippy --locked -p nian-pass-browser-host --all-targets --all-features -- -D warnings
	RUSTDOCFLAGS="-D warnings" cargo doc --locked -p nian-pass-browser-host --all-features --no-deps

browser-integration-check: browser-install
	$(MAKE) browser-source-check
	$(MAKE) browser-native-protocol-check
	$(MAKE) browser-native-host-check
	pnpm --filter @nian-pass/browser-extension exec vitest run \
		src/background-native.test.ts src/browser-integration.test.ts src/popup.test.ts
	cargo test --locked -p nian-pass-desktop browser_bridge
	cargo test --locked -p nian-pass-desktop browser_vault_session_identity
	cargo test --locked -p nian-pass-desktop browser_final_read

windows-cross-check:
	@echo "Cross-check persistence, browser host, IPC, installer, and desktop for Windows..."
	cargo check --locked --all-targets --target x86_64-pc-windows-gnu \
		-p vault-session -p vault-sync -p windows-safe-replace -p sync-provider-core -p sync-engine \
		-p sync-provider-webdav -p sync-provider-s3 -p browser-native-protocol \
		-p sync-provider-gateway \
		-p nian-pass-browser-host -p nian-pass-desktop

sync-source-check:
	@echo "Check M7 sync architecture and secret-persistence invariants..."
	node scripts/check_sync.mjs

sync-core-check: sync-source-check
	@echo "Check provider-independent sync contract and engine..."
	cargo test --locked -p sync-provider-core -p sync-engine
	cargo clippy --locked -p sync-provider-core -p sync-engine --all-targets --all-features -- -D warnings
	RUSTDOCFLAGS="-D warnings" cargo doc --locked -p sync-provider-core -p sync-engine --all-features --no-deps

sync-provider-check: sync-source-check
	@echo "Check WebDAV, S3, and gateway conditional transports..."
	cargo test --locked -p sync-provider-webdav -p sync-provider-s3 -p sync-provider-gateway
	cargo clippy --locked -p sync-provider-webdav -p sync-provider-s3 -p sync-provider-gateway --all-targets --all-features -- -D warnings
	RUSTDOCFLAGS="-D warnings" cargo doc --locked -p sync-provider-webdav -p sync-provider-s3 -p sync-provider-gateway --all-features --no-deps

sync-integration-check:
	@echo "Run deterministic loopback provider and crash-recovery integration tests..."
	cargo test --locked -p sync-engine --test sync
	cargo test --locked -p sync-provider-webdav
	cargo test --locked -p sync-provider-s3
	cargo test --locked -p sync-provider-gateway --test sync_integration

gateway-source-check:
	@echo "Check M7.5 gateway architecture and security invariants..."
	node scripts/check_gateway.mjs

gateway-server-check: gateway-source-check
	@echo "Check the Linux self-hosted opaque-object gateway..."
	cargo test --locked -p nian-pass-sync-gateway
	cargo clippy --locked -p nian-pass-sync-gateway --all-targets --all-features -- -D warnings
	RUSTDOCFLAGS="-D warnings" cargo doc --locked -p nian-pass-sync-gateway --all-features --no-deps

gateway-provider-check: gateway-source-check
	@echo "Check the strict desktop gateway transport..."
	cargo test --locked -p sync-provider-gateway
	cargo clippy --locked -p sync-provider-gateway --all-targets --all-features -- -D warnings
	RUSTDOCFLAGS="-D warnings" cargo doc --locked -p sync-provider-gateway --all-features --no-deps

gateway-integration-check: gateway-source-check
	@echo "Run real gateway and encrypted KDBX sync-engine integration tests..."
	cargo test --locked -p nian-pass-sync-gateway --test http
	cargo test --locked -p sync-provider-gateway --test sync_integration
	cargo test --locked -p nian-pass-desktop sync::

gateway-container-check: gateway-source-check
	@echo "Run the documented non-root gateway container lifecycle smoke..."
	bash scripts/check_gateway_container.sh
	test ! -e deploy/gateway.env

release-policy-check:
	@echo "Check pinned release inputs, versions, dependencies, actions, and containers..."
	node scripts/check_release_source.mjs
	$(MAKE) node-license-check

node-license-check:
	@echo "Check production Node dependency licenses..."
	pnpm install --frozen-lockfile
	node scripts/check_node_licenses.mjs

security-hardening-check:
	$(MAKE) security-check
	$(MAKE) mobile-source-check
	$(MAKE) browser-source-check
	$(MAKE) sync-source-check
	$(MAKE) gateway-source-check
	$(MAKE) release-policy-check

release-source-prebuild-check:
	@echo "Require clean, exact tagged source before a native release build..."
	node scripts/check_release_source.mjs --prebuild

release-source-postbuild-check:
	@echo "Verify release identity and reject unexpected post-build source mutations..."
	RELEASE_COMMIT="$(RELEASE_COMMIT)" RELEASE_VERSION="$(RELEASE_VERSION)" node scripts/check_release_source.mjs --postbuild

release-source-check: release-source-prebuild-check

# Capture provenance before any native tool can create generated build state.
# Each release target passes this immutable identity explicitly to its post-build
# verifier instead of reading HEAD or VERSION again after the build.
release-browser-package release-linux-build release-android-build release-gateway-image: private RELEASE_COMMIT := $(shell git rev-parse HEAD)
release-browser-package release-linux-build release-android-build release-gateway-image: private RELEASE_VERSION := $(shell cat VERSION)

release-browser-package: release-source-check
	$(MAKE) browser-build browser-artifact-check
	pnpm --filter @nian-pass/browser-extension package
	RELEASE_COMMIT="$(RELEASE_COMMIT)" RELEASE_VERSION="$(RELEASE_VERSION)" $(MAKE) release-source-postbuild-check

release-linux-build: release-source-check
	pnpm install --frozen-lockfile
	NIAN_PASS_COMMIT="$$(git rev-parse HEAD)" pnpm --filter @nian-pass/desktop tauri build --ci --bundles appimage,deb
	cargo build --locked --release -p nian-pass-browser-host
	node scripts/package_native_host.mjs linux-x86_64 target/release/nian-pass-browser-host
	RELEASE_COMMIT="$(RELEASE_COMMIT)" RELEASE_VERSION="$(RELEASE_VERSION)" $(MAKE) release-stage

release-windows-build:
	pwsh -NoProfile -NonInteractive -File scripts/release_windows.ps1

release-android-build: release-source-check mobile-android-check
	RELEASE_COMMIT="$(RELEASE_COMMIT)" RELEASE_VERSION="$(RELEASE_VERSION)" $(MAKE) release-stage

release-gateway-image: release-source-check
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

release-stage: release-source-postbuild-check
	node scripts/stage_release.mjs

release-assemble:
	node scripts/assemble_release.mjs

release-artifact-check: release-source-check
	node scripts/release_artifacts.mjs scan
	test -s "$${ARTIFACT_DIR:-artifacts/release}/release-status.md"
	node scripts/release_artifacts.mjs sbom
	node scripts/release_artifacts.mjs manifest
	node scripts/release_artifacts.mjs checksums

release-check: release-source-check quality-check gateway-container-check release-browser-package release-artifact-check

mobile-source-check:
	@echo "Check deterministic mobile foundation sources..."
	node scripts/check_mobile_foundation.mjs

mobile-tools-check:
	@echo "Check Android CLI build prerequisites..."
	scripts/check_mobile_tools.sh

mobile-android-check: mobile-source-check mobile-tools-check
	@echo "Build the real Tauri Android application as APKs (arm64 + x86_64)..."
	NIAN_PASS_COMMIT="$$(git rev-parse HEAD 2>/dev/null || printf unknown)" pnpm --filter @nian-pass/desktop tauri android build --apk --target aarch64 x86_64 --ci
	@echo "Run focused Android native source tests..."
	apps/desktop/src-tauri/gen/android/gradlew -p apps/desktop/src-tauri/gen/android \
		:app:testUniversalDebugUnitTest :app:compileUniversalDebugAndroidTestKotlin
	@artifact="$$(find apps/desktop/src-tauri/gen/android/app/build/outputs/apk -type f -name '*.apk' -print -quit 2>/dev/null)"; \
		test -n "$$artifact" || { echo "Android build completed without an APK artifact." >&2; exit 1; }; \
		scripts/verify_android_release.sh "$$artifact" && \
		echo "Android APK verified: $$artifact"

mobile-ios-tools-check:
	@echo "Check Apple resumption macOS/Xcode iOS build prerequisites..."
	scripts/check_mobile_ios_tools.sh

mobile-ios-source-check:
	@echo "Check retained Apple resumption host and Credential Provider sources..."
	node scripts/check_ios_foundation.mjs

mobile-ios-check: mobile-ios-tools-check mobile-ios-source-check
	@echo "Build the Apple resumption Tauri iOS host and embedded Credential Provider Extension..."
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
	$(MAKE) sync-source-check
	$(MAKE) gateway-source-check
	$(MAKE) release-policy-check

quick-check:
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

quality-check:
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
