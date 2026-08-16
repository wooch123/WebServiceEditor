import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  REPOSITORY_ROOT,
  Validation,
  finishVerification,
  isMainModule,
  unexpectedFailure,
} from "./lib/verification.mjs";
import { validatePhase17 } from "./verify-phase17.mjs";

export const PHASE18_EVIDENCE_PATH =
  "artifacts/phase18/accessibility-security-performance-validation.json";
export const PHASE18_BROWSER_EVIDENCE_PATH =
  "artifacts/phase18/browser-security-performance-validation.json";

const FILES = {
  adr: "docs/adr/0019-accessibility-security-performance-domain.md",
  domain: "packages/domain/src/auth.ts",
  metadata: "apps/server/src/metadata/database.ts",
  config: "apps/server/src/config.ts",
  app: "apps/server/src/app.ts",
  auth: "apps/server/src/auth/auth-service.ts",
  routes: "apps/server/src/routes/auth.ts",
  performance: "apps/server/src/performance/performance-monitor.ts",
  serverTest: "apps/server/test/integration/auth-security-performance.test.ts",
  fetch: "apps/web/src/services/api-fetch.ts",
  boundary: "apps/web/src/features/auth/AuthBoundary.tsx",
  boundaryTest: "apps/web/src/features/auth/AuthBoundary.test.tsx",
  styles: "apps/web/src/styles.css",
  themeTest: "packages/theme-core/test/theme-core.test.ts",
  traceability: "docs/requirement-traceability.json",
  status: "docs/implementation-status.md",
};

async function sources(root) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(FILES).map(async ([key, path]) => [
        key,
        await readFile(resolve(root, path), "utf8"),
      ]),
    ),
  );
}

export function inspectPhase18Contract(source) {
  return {
    architecture:
      /one production Fastify process bound to loopback/u.test(source.adr) &&
      /https:\/\/webeditor\.dove9999\.com/u.test(source.adr) &&
      /credentials and tunnel tokens remain outside the repository/iu.test(
        source.adr,
      ),
    metadataV15:
      /LATEST_METADATA_SCHEMA_VERSION\s*=\s*(?:1[5-9]|[2-9]\d+)/u.test(
        source.metadata,
      ) &&
      /version:\s*15/u.test(source.metadata) &&
      /CREATE TABLE admin_accounts/u.test(source.metadata) &&
      /CREATE TABLE auth_sessions/u.test(source.metadata) &&
      /CREATE TABLE auth_events/u.test(source.metadata),
    passwordSecurity:
      /hashSync/u.test(source.auth) &&
      /verifySync/u.test(source.auth) &&
      /memoryCost:\s*19_456/u.test(source.auth) &&
      /password_hash GLOB '\$argon2id\$\*'/u.test(source.metadata),
    sessionSecurity:
      /__Host-webeditor_session/u.test(source.auth) &&
      /httpOnly:\s*true/u.test(source.auth) &&
      /sameSite:\s*"strict"/u.test(source.auth) &&
      /secure:\s*this\.config\.secureCookies/u.test(source.auth) &&
      /sessionLifetimeHours/u.test(source.config),
    csrf:
      /__Host-webeditor_csrf/u.test(source.auth) &&
      /x-csrf-token/u.test(source.auth) &&
      /request\.headers\.origin === this\.config\.publicOrigin/u.test(
        source.auth,
      ) &&
      /credentials:\s*"same-origin"/u.test(source.fetch),
    rateLimit:
      /rateLimit:\s*\{\s*max:\s*5/su.test(source.routes) &&
      /timeWindow:\s*"1 minute"/u.test(source.routes),
    headers:
      /contentSecurityPolicy/u.test(source.app) &&
      /frameAncestors:\s*\["'none'"\]/u.test(source.app) &&
      /frameguard:\s*\{\s*action:\s*"deny"/u.test(source.app) &&
      /hsts/u.test(source.app) &&
      /referrerPolicy/u.test(source.app),
    networkBoundary:
      /trustProxy:\s*"127\.0\.0\.1"/u.test(source.app) &&
      /SERVER_HOST\s*=\s*"127\.0\.0\.1"/u.test(source.config) &&
      /fastifyStatic/u.test(source.app),
    boundedPerformance:
      /capacity\s*=\s*4096/u.test(source.performance) &&
      /request\.routeOptions\.url/u.test(source.performance) &&
      /p95Ms/u.test(source.performance) &&
      !/(?:request\.body|request\.cookies|request\.query)/u.test(
        source.performance,
      ),
    performanceBehavior:
      /100-project list within budget/u.test(source.serverTest) &&
      /toBeLessThanOrEqual\(2_000\)/u.test(source.serverTest) &&
      /toBeLessThanOrEqual\(300\)/u.test(source.serverTest) &&
      /performance\/summary/u.test(source.serverTest),
    authenticationBehavior:
      /Argon2id, strict cookies, CSRF/u.test(source.serverTest) &&
      /toBe\(429\)/u.test(source.serverTest) &&
      /critical|high/iu.test(`${source.adr}\n${source.status}`),
    accessibleBoundary:
      /autoComplete="username"/u.test(source.boundary) &&
      /autoComplete="current-password"/u.test(source.boundary) &&
      /role="heading"/u.test(source.boundary) &&
      /axe\.run/u.test(source.boundaryTest),
    reducedMotion:
      /prefers-reduced-motion:\s*reduce/u.test(source.styles) &&
      /color.?vision|protanopia|deuteranopia|tritanopia/iu.test(
        source.themeTest,
      ),
    noClientSqlOrScript:
      !/(?:\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE FROM\b|eval\s*\()/u.test(
        `${source.fetch}\n${source.boundary}`,
      ),
  };
}

export function inspectPhase18BrowserEvidence(evidence) {
  const performance = evidence?.performance ?? {};
  return {
    metadata:
      evidence?.schemaVersion === 1 &&
      evidence?.result === "PASS" &&
      evidence?.target === "actual HTTPS domain" &&
      evidence?.url === "https://webeditor.dove9999.com/" &&
      evidence?.viewport?.width === 1280 &&
      evidence?.viewport?.height === 720,
    deployment:
      evidence?.deployment?.httpStatus === 200 &&
      evidence?.deployment?.https === true &&
      evidence?.deployment?.authenticationRequired === true &&
      evidence?.deployment?.authenticatedUiVisible === true &&
      evidence?.deployment?.tunnelConnected === true &&
      evidence?.deployment?.originBoundToLoopback === true &&
      evidence?.deployment?.credentialsOutsideRepository === true,
    security:
      evidence?.security?.contentSecurityPolicy === true &&
      evidence?.security?.frameAncestorsNone === true &&
      evidence?.security?.hsts === true &&
      evidence?.security?.xFrameOptionsDeny === true &&
      evidence?.security?.noSniff === true &&
      evidence?.security?.referrerPolicyNoReferrer === true &&
      evidence?.security?.secureHttpOnlyStrictSessionCookie === true &&
      evidence?.security?.csrfProtectedMutation === true &&
      evidence?.security?.loginRateLimited === true &&
      evidence?.security?.criticalHighDefectCount === 0,
    accessibility:
      evidence?.accessibility?.axeViolationCount === 0 &&
      evidence?.accessibility?.visibleUnlabeledButtonCount === 0 &&
      evidence?.accessibility?.semanticLoginHeading === true &&
      evidence?.accessibility?.labeledLoginInputs === 2 &&
      evidence?.accessibility?.keyboardFocusableControls === true &&
      evidence?.accessibility?.focusVisibleSupported === true &&
      evidence?.accessibility?.reducedMotionRulePresent === true &&
      evidence?.accessibility?.themeContrastPresetCount === 120 &&
      evidence?.accessibility?.colorVisionModes === 3,
    performance:
      performance.projectCount === 100 &&
      performance.projectListMs <= performance.projectListBudgetMs &&
      performance.projectSearchMs <= performance.projectSearchBudgetMs &&
      performance.actualDomainFirstProjectMs <= 2000 &&
      performance.editorOpenMs <= 2000 &&
      performance.serverProjectListP95Ms <= 2000 &&
      performance.serverProjectCreateP95Ms <= 1000 &&
      performance.sampleCount >= 102 &&
      performance.budgetsPassed === true,
    clean:
      evidence?.consoleErrorCount === 0 && evidence?.failedRequestCount === 0,
  };
}

export async function validatePhase18({
  repositoryRoot = REPOSITORY_ROOT,
  includeBrowserEvidence = true,
  includePhase17Regression = true,
  includeGovernance = true,
} = {}) {
  const validation = new Validation(
    "Phase 18 Accessibility, Security, Performance, Actual Domain",
  );
  const source = await sources(repositoryRoot);
  const inspection = inspectPhase18Contract(source);
  for (const [name, value] of Object.entries(inspection)) {
    validation.check(value === true, `Phase 18 contract failed: ${name}`);
  }

  let browserInspection = {};
  if (includeBrowserEvidence) {
    try {
      browserInspection = inspectPhase18BrowserEvidence(
        JSON.parse(
          await readFile(
            resolve(repositoryRoot, PHASE18_BROWSER_EVIDENCE_PATH),
            "utf8",
          ),
        ),
      );
      for (const [name, value] of Object.entries(browserInspection)) {
        validation.check(value === true, `Phase 18 browser failed: ${name}`);
      }
    } catch (error) {
      validation.check(false, "Phase 18 browser evidence is missing", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (includeGovernance) {
    const requirements = JSON.parse(source.traceability).requirements;
    const builder = requirements.find(({ id }) => id === "REQ-001");
    validation.check(
      builder?.implementation.includes(
        "apps/server/src/auth/auth-service.ts",
      ) &&
        builder?.implementation.includes(
          "apps/server/src/performance/performance-monitor.ts",
        ) &&
        builder?.tests.includes("scripts/verify-phase18.mjs") &&
        builder?.evidence.includes(PHASE18_EVIDENCE_PATH) &&
        builder?.evidence.includes(PHASE18_BROWSER_EVIDENCE_PATH),
      "REQ-001 Phase 18 traceability is incomplete",
    );
    validation.check(
      /\|\s*18\s*\|\s*OPERATIONALLY VERIFIED\s*\|/u.test(source.status) &&
        /## Phase 18 evidence/u.test(source.status) &&
        source.status.includes(PHASE18_EVIDENCE_PATH),
      "Phase 18 implementation status is incomplete",
    );
  }

  let phase17Regression = "NOT_RUN";
  if (includePhase17Regression) {
    const previous = await validatePhase17({
      repositoryRoot,
      includeBrowserEvidence: false,
      includePhase16Regression: false,
      includeGovernance: false,
    });
    phase17Regression = previous.result;
    validation.check(previous.result === "PASS", "Phase 17 regression failed", {
      failures: previous.failures,
    });
  }

  return validation.result({
    inspection,
    browserInspection,
    phase17Regression,
    browserEvidencePath: PHASE18_BROWSER_EVIDENCE_PATH,
  });
}

if (isMainModule(import.meta.url)) {
  try {
    await finishVerification(PHASE18_EVIDENCE_PATH, await validatePhase18());
  } catch (error) {
    await finishVerification(
      PHASE18_EVIDENCE_PATH,
      unexpectedFailure(
        "Phase 18 Accessibility, Security, Performance, Actual Domain",
        error,
      ),
    );
  }
}
