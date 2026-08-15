# ADR 0003: Canonical theme packaging

Status: accepted  
Date: 2026-08-15

## Context

The supplied `webeditor_theme_presets_v3.json` is immutable source evidence,
while the product specification requires the runtime manifest at
`packages/theme-core/src/presets/webeditor-theme-presets.v3.json`.
Reconstructing colors, converting them to another color space, or rounding
values can break contrast ratios at the documented boundaries.

## Decision

- Preserve the supplied root file unchanged as source evidence.
- Keep a byte-identical package copy at the specified runtime path and fail the
  Phase 2 gate if either file differs.
- Resolve all 52 semantic tokens in `@webeditor/theme-core`; web applications
  may add framework typing but may not transform token values.
- Treat `manifestSha256`, `tokenHash`, and provenance hashes as supplied opaque
  identifiers unless their canonicalization algorithm is separately defined.
- Model theme revisions independently from immutable page/data versions.
- Keep generated screenshots and reports under ignored `artifacts/`; their
  SHA-256 index is release evidence, not product source.

## Consequences

The source manifest is duplicated deliberately, but validation prevents drift.
Portals receive the active variables from the document root, so dialogs and the
theme picker use the same theme as the editor shell. Distribution remains
blocked on the manifest's required license and trademark review.
