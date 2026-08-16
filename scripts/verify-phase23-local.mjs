import { finishVerification, unexpectedFailure } from "./lib/verification.mjs";
import { validatePhase23Local } from "./verify-phase23.mjs";

export const PHASE23_LOCAL_EVIDENCE_PATH =
  "artifacts/phase23/non-windows-final-audit-validation.json";

try {
  await finishVerification(
    PHASE23_LOCAL_EVIDENCE_PATH,
    await validatePhase23Local(),
  );
} catch (error) {
  await finishVerification(
    PHASE23_LOCAL_EVIDENCE_PATH,
    unexpectedFailure("Phase 23 Non-Windows Final Audit", error),
  );
}
