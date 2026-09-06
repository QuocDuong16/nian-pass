# Release validation status

Copy this template into each release record and replace only with observed
results. `NOT RUN` is a result, not a placeholder that may be inferred as pass.

```text
Forgejo quality-check: PASS / FAIL / NOT RUN
Gateway container smoke: PASS / FAIL / NOT RUN

Linux desktop build: PASS / FAIL / NOT RUN
Linux desktop runtime smoke: PASS / FAIL / NOT RUN

Windows desktop build: PASS / FAIL / NOT RUN
Windows desktop runtime smoke: PASS / FAIL / NOT RUN

Browser Chromium package: PASS / FAIL / NOT RUN
Browser Firefox package: PASS / FAIL / NOT RUN
Native Messaging Linux smoke: PASS / FAIL / NOT RUN
Native Messaging Windows smoke: PASS / FAIL / NOT RUN

Android release APK: PASS / FAIL / NOT RUN
Android device runtime: PASS / FAIL / NOT RUN

Gateway release image: PASS / FAIL / NOT RUN

Artifact checksums: PASS / FAIL
Artifact secret scan: PASS / FAIL

SBOM: PASS / FAIL / NOT RUN

Windows signing: PASS / NOT CONFIGURED / NOT RUN
Android signing: PASS / NOT CONFIGURED / NOT RUN
Other signing: PASS / NOT CONFIGURED / NOT RUN
```

Also record the release tag, `VERSION`, commit SHA, workflow run URL or ID,
artifact manifest, accepted risks, and any partial smoke that was insufficient
for a platform PASS.
