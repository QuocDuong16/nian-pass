# Release security checklist

- [ ] Exact `v<VERSION>` tag and clean source commit
- [ ] Forgejo `make quality-check` green
- [ ] No committed secrets, `.env`, certificates, private keys, or real vaults
- [ ] No debug flags, development endpoints, or unintended source maps
- [ ] Rust/Node dependency audit and accepted advisory rationale reviewed
- [ ] Desktop CSP, Tauri plugins/capabilities, Android permissions, and browser permissions reviewed
- [ ] Windows installer, Linux AppImage/deb, browser packages, Android APK, and gateway image statuses recorded
- [ ] Test-only KDBX fixtures used for runtime smoke; no user vault used
- [ ] Native Messaging install/doctor/uninstall checked on available platforms
- [ ] SHA-256 checksums and release manifest generated
- [ ] Artifact secret scan passed; understand that it is not proof of absence
- [ ] SBOM status recorded
- [ ] Windows, Android, browser-store, container/checksum signing status recorded honestly
- [ ] Linux/Windows/Android/browser/gateway runtime statuses use PASS, FAIL, or NOT RUN without conversion
- [ ] Backup, restore, rollback, lost-password, and lost-token notes included in release notes
