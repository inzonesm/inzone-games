# Browser SDK delivery

Status: implementation pending verification.

This branch establishes a hosted review path for browser SDK work. Its initial commit changes documentation only; it does not contain or validate the previously reported local bootstrap implementations.

## Scope

- Prioritize games running in the InZone web app.
- Preserve Firebase authentication and Hexclave's analytics-only integration.
- Inspect current source before adding or recovering any bootstrap code.
- Verify iframe-local initialization, early and late consumers, duplicate initialization, bounded failure, unsupported capabilities, asset loading, and development-only activation.
- Record executed browser checks separately from static inspection and unit tests.

## Delivery

Publish bounded implementation changes to this branch for review. Keep the pull request in draft until the implementation and required checks are available. No merge, deployment, production authentication changes, or Flutter work is included in this publication check.
