# 01 Engine: no back-to-back turns when avoidable

Status: needs-triage (waiting for the simplified prototype to be approved)
Blocked by: none

Spec: `.scratch/simplify/spec.md` → "Rotation rules" #2.

When the engine (`src/engine/schedule.ts`, `rotation.ts`) seats a Member for an Event of a Responsibility, and that Member also served the previous Event of the same Responsibility (for any reason: Cover, Make-up Turn, Time Off pass-over, someone leaving), pick the next eligible Member instead. The skipped Member keeps their place at the front of the queue (same as a Time Off pass-over, see ADR 0001). Only seat them back-to-back when nobody else is eligible.

Acceptance:
- Unit tests in `src/engine/tests` for: 3-person weekly rotation with a Cover (coverer gets ≥2-week gap, together with the Make-up Turn swap); Time Off causing a would-be double; 2-person group where back-to-back is unavoidable.
- Existing engine tests still pass.
- Record the rule in an ADR (extends 0001) and the GLOSSARY "Rotation" entry.
