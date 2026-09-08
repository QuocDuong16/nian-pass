# Release validation status

Copy this template into each release record and replace only with observed
results. `NOT RUN` is a result, not a placeholder that may be inferred as pass.
Draft staging may record Forgejo as `NOT RUN`; a published release must record
Forgejo canonical CI and GitHub Release publication as `PASS`.

Record `Release class: prerelease` for suffixed versions such as
`0.1.0-rc.1`, and `Release class: final` for unsuffixed versions. Draft status
does not change this source-derived classification.

```text
Forgejo canonical CI                   PASS / FAIL / NOT RUN

GitHub release preflight              PASS / FAIL / NOT RUN

Windows release build                 PASS / FAIL / NOT RUN
Windows native process smoke          PASS / FAIL / NOT RUN
Windows full GUI runtime              PASS / FAIL / NOT RUN
Windows Authenticode                  PASS / NOT CONFIGURED / NOT RUN

Linux AppImage                        PASS / FAIL / NOT RUN
Linux deb                             PASS / FAIL / NOT RUN
Linux native-host package             PASS / FAIL / NOT RUN
Linux native process smoke            PASS / FAIL / NOT RUN
Linux full GUI runtime                PASS / FAIL / NOT RUN

Chromium package                      PASS / FAIL / NOT RUN
Firefox package                       PASS / FAIL / NOT RUN
Browser store signing                 PASS / NOT CONFIGURED / NOT RUN

Android APK                           PASS / FAIL / NOT RUN
Android static security verification  PASS / FAIL / NOT RUN
Android runtime                       PASS / FAIL / NOT RUN
Android signing                       PASS / NOT CONFIGURED / NOT RUN

Gateway image                         PASS / FAIL / NOT RUN
Gateway container smoke               PASS / FAIL / NOT RUN
Gateway registry publication          PASS / NOT CONFIGURED / NOT RUN

Artifact secret scan                  PASS / FAIL
Docker nested-layer scan              PASS / FAIL
SBOM                                  PASS / FAIL
Release manifest                      PASS / FAIL
SHA256SUMS                            PASS / FAIL
GitHub Release publication            PASS / DRAFT / NOT RUN
```

Also record the release tag, `VERSION`, commit SHA, workflow run URL or ID,
artifact manifest, hosted-runner image labels, accepted risks, and any partial
smoke that was insufficient for a platform runtime PASS.

Draft assets may be replaced during review. Once the GitHub Release is
published, this workflow must not alter its assets, checksums, notes, or title;
publish corrected bytes only under a new version and tag.
