# Task completion and evidence

- Canonical full Linux gate: `rtk make quality-check`; shorter broad check: `rtk make quick-check`. Use the narrowest relevant `make` target during iterative work.
- Documentation/config-only changes: `rtk make docs-check`, relevant source/config checks, and `rtk git diff --check`. Serena onboarding changes also require `rtk serena memories check` and `rtk serena project health-check`.
- Do not treat local static checks, Forgejo CI, cross-compilation, artifact inspection, and platform runtime as interchangeable evidence. State which environment ran and which did not.
- Windows ordinary Save remains disabled without reviewed native runtime evidence; cross-compilation alone is insufficient. iOS runtime requires macOS/Xcode; Android instrumentation/device evidence is distinct from Linux source checks.
- Release-source gates intentionally reject dirty trees. Do not stage, tag, publish, dispatch, or deploy unless the task explicitly asks for it.