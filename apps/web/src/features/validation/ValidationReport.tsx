import type {
  ValidationIssueDto,
  ValidationResult,
  ValidationRunDto,
  ValidationTargetDto,
} from "@webeditor/domain";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  Play,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  listValidationRuns,
  runProjectValidation,
} from "@/services/validation-api";

const resultLabel: Record<ValidationResult, string> = {
  PASS: "통과",
  WARNING: "주의",
  FAIL: "실패",
  BLOCKED: "차단",
};

function IssueIcon({ result }: { result: ValidationIssueDto["result"] }) {
  if (result === "WARNING") return <TriangleAlert aria-hidden="true" />;
  return <AlertCircle aria-hidden="true" />;
}

export function ValidationReport({
  projectId,
  projectRevision,
  onNavigate,
}: {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly onNavigate: (target: ValidationTargetDto) => void;
}) {
  const [run, setRun] = useState<ValidationRunDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const result = await listValidationRuns(projectId, signal);
      setRun(result.runs[0] ?? null);
    } catch (reason) {
      if (signal?.aborted) return;
      setError(
        reason instanceof Error ? reason.message : "검증 결과 불러오기 실패",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [projectId]);

  const execute = async (inventoryOnly: boolean) => {
    setRunning(true);
    setError("");
    try {
      setRun(
        await runProjectValidation(projectId, projectRevision, inventoryOnly),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "검증 실패");
    } finally {
      setRunning(false);
    }
  };

  const inventoryProgress = useMemo(() => {
    if (!run || run.inventoryRequired === 0) return 0;
    return (run.inventoryVerified / run.inventoryRequired) * 100;
  }, [run]);

  return (
    <section className="validation-report" aria-label="검증 보고서">
      <div className="validation-report-toolbar">
        <div>
          <h2>검증</h2>
          <span>
            {run ? new Date(run.completedAt).toLocaleString() : "실행 전"}
          </span>
        </div>
        <div className="validation-report-actions">
          <Button
            className="validation-action"
            type="button"
            variant="outline"
            disabled={running}
            onClick={() => void execute(true)}
          >
            <RefreshCw aria-hidden="true" />
            목록
          </Button>
          <Button
            className="validation-action"
            type="button"
            disabled={running}
            onClick={() => void execute(false)}
          >
            {running ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
            실행
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>오류</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="validation-loading" role="status">
          <LoaderCircle className="animate-spin" aria-hidden="true" />
          불러오는 중
        </div>
      ) : run ? (
        <>
          <div className="validation-summary-grid">
            <Card>
              <CardHeader>
                <CardTitle>결과</CardTitle>
                <Badge data-result={run.status}>
                  {resultLabel[run.status]}
                </Badge>
              </CardHeader>
              <CardContent>
                <strong>{run.summary.fail + run.summary.blocked}</strong>
                <span>오류</span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>목록</CardTitle>
                <Badge variant="outline">
                  {run.inventoryVerified}/{run.inventoryRequired}
                </Badge>
              </CardHeader>
              <CardContent>
                <Progress value={inventoryProgress} />
                <span>테스트·증거</span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>주의</CardTitle>
                <Badge variant="outline">{run.summary.warning}</Badge>
              </CardHeader>
              <CardContent>
                <strong>{run.issues.length}</strong>
                <span>항목</span>
              </CardContent>
            </Card>
          </div>

          {run.issues.length === 0 ? (
            <Alert className="validation-pass">
              <CheckCircle2 aria-hidden="true" />
              <AlertTitle>통과</AlertTitle>
              <AlertDescription>오류 없음</AlertDescription>
            </Alert>
          ) : (
            <ScrollArea className="validation-issue-scroll">
              <div className="validation-issues">
                {run.issues.map((issue) => (
                  <button
                    type="button"
                    className="validation-issue"
                    key={issue.id}
                    onClick={() => onNavigate(issue.target)}
                  >
                    <span data-result={issue.result}>
                      <IssueIcon result={issue.result} />
                    </span>
                    <span>
                      <strong>{issue.title}</strong>
                      <small>{issue.detail}</small>
                    </span>
                    <ExternalLink aria-hidden="true" />
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </>
      ) : (
        <div className="validation-empty">
          <CheckCircle2 aria-hidden="true" />
          <strong>실행 전</strong>
        </div>
      )}
    </section>
  );
}
