# Browser SDK delivery

Status: local browser bootstrap implemented and tested; independent review pending.

This branch contains a new local-only bootstrap implementation and reproducible tests. It does not recover or validate previously reported sandbox commits. See BROWSER_SDK_HARNESS.md for commands, evidence and limitations.

## Scope

- Prioritize games running in the InZone web app.
- Preserve Firebase authentication and Hexclave's analytics-only integration.
- Inspect current source before adding or recovering any bootstrap code.
- Verify iframe-local initialization, early and late consumers, duplicate initialization, bounded failure, unsupported capabilities, asset loading, and development-only activation.
- Record executed browser checks separately from static inspection and unit tests.

## Delivery

Publish bounded implementation changes to this branch for review. Keep the pull request in draft until the implementation and required checks are available. No merge, deployment, production authentication changes, or Flutter work is included in this publication check.
