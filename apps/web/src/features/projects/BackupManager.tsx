import type { ProjectBackupDto } from "@webeditor/domain";
import {
  ArchiveRestore,
  CheckCircle2,
  DatabaseBackup,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createProjectBackup,
  listProjectBackups,
  restoreProjectBackup,
  verifyProjectBackup,
} from "@/services/backup-api";
import { newIdempotencyKey, type ProjectDto } from "@/services/projects-api";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "백업 작업에 실패했습니다.";
}

export function BackupManager({
  projects,
  onRestored,
}: {
  readonly projects: readonly ProjectDto[];
  readonly onRestored: (project: ProjectDto) => void;
}) {
  const [backups, setBackups] = useState<ProjectBackupDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [restoreBackup, setRestoreBackup] = useState<ProjectBackupDto | null>(
    null,
  );
  const [restoreName, setRestoreName] = useState("");
  const [restoreSlug, setRestoreSlug] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setBackups(await listProjectBackups());
    } catch (loadError) {
      setError(message(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(project: ProjectDto) {
    setBusyKey(`create:${project.id}`);
    setError(null);
    setNotice(null);
    try {
      const backup = await createProjectBackup(project.id, {
        expectedRevision: project.revision,
        idempotencyKey: newIdempotencyKey("backup-create"),
      });
      setBackups((current) => [
        backup,
        ...current.filter((item) => item.id !== backup.id),
      ]);
      setNotice(`${project.name} 백업 완료`);
    } catch (createError) {
      setError(message(createError));
    } finally {
      setBusyKey(null);
    }
  }

  async function verify(backup: ProjectBackupDto) {
    setBusyKey(`verify:${backup.id}`);
    setError(null);
    setNotice(null);
    try {
      const drill = await verifyProjectBackup(
        backup.id,
        newIdempotencyKey("backup-verify"),
      );
      setBackups((current) =>
        current.map((item) =>
          item.id === backup.id
            ? { ...item, status: "VERIFIED", verifiedAt: drill.checkedAt }
            : item,
        ),
      );
      setNotice(`${backup.sourceProjectName} 점검 통과`);
    } catch (verifyError) {
      setError(message(verifyError));
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  function openRestore(backup: ProjectBackupDto) {
    setRestoreBackup(backup);
    setRestoreName(`${backup.sourceProjectName} 복원`);
    setRestoreSlug(
      `${backup.sourceProjectSlug}-restore-${backup.id.slice(0, 6)}`,
    );
  }

  async function restore() {
    if (restoreBackup === null) return;
    setBusyKey(`restore:${restoreBackup.id}`);
    setError(null);
    setNotice(null);
    try {
      const result = await restoreProjectBackup(restoreBackup.id, {
        name: restoreName,
        slug: restoreSlug,
        idempotencyKey: newIdempotencyKey("backup-restore"),
      });
      onRestored(result.project as ProjectDto);
      setNotice(`${result.project.name} 복원 완료`);
      setRestoreBackup(null);
    } catch (restoreError) {
      setError(message(restoreError));
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) {
    return (
      <div className="backup-loading" role="status">
        <Spinner /> 백업 불러오는 중
      </div>
    );
  }

  if (error !== null && backups.length === 0) {
    return (
      <Empty className="backup-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <DatabaseBackup aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>불러오기 실패</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" onClick={() => void load()}>
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
            다시 시도
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="backup-manager">
      <Alert>
        <ShieldCheck aria-hidden="true" />
        <AlertTitle>별도 보관</AlertTitle>
        <AlertDescription>휴지통과 독립된 복구 사본</AlertDescription>
      </Alert>

      {error !== null && (
        <Alert variant="destructive">
          <AlertTitle>작업 실패</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice !== null && (
        <Alert>
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>완료</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <section
        className="backup-projects"
        aria-labelledby="backup-projects-title"
      >
        <h2 id="backup-projects-title">프로젝트</h2>
        {projects.length === 0 ? (
          <p className="backup-muted">활성 프로젝트 없음</p>
        ) : (
          <div className="backup-project-list">
            {projects.map((project) => (
              <div className="backup-project-row" key={project.id}>
                <span>{project.name}</span>
                <Button
                  type="button"
                  variant="outline"
                  className="backup-row-action"
                  disabled={busyKey !== null}
                  onClick={() => void create(project)}
                >
                  {busyKey === `create:${project.id}` ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <DatabaseBackup
                      data-icon="inline-start"
                      aria-hidden="true"
                    />
                  )}
                  백업
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section
        className="backup-snapshots"
        aria-labelledby="backup-snapshots-title"
      >
        <h2 id="backup-snapshots-title">복구 사본</h2>
        {backups.length === 0 ? (
          <p className="backup-muted">백업 없음</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>프로젝트</TableHead>
                <TableHead>생성</TableHead>
                <TableHead>크기</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups.map((backup) => (
                <TableRow key={backup.id}>
                  <TableCell>
                    <div className="backup-name-cell">
                      <strong>{backup.sourceProjectName}</strong>
                      <span>r{backup.sourceProjectRevision}</span>
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(backup.createdAt)}</TableCell>
                  <TableCell>{formatBytes(backup.totalBytes)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        backup.status === "VERIFIED"
                          ? "secondary"
                          : "destructive"
                      }
                    >
                      {backup.status === "VERIFIED" ? "검증됨" : "손상"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="backup-row-actions">
                      <Button
                        type="button"
                        variant="outline"
                        className="backup-row-action"
                        disabled={busyKey !== null}
                        onClick={() => void verify(backup)}
                      >
                        {busyKey === `verify:${backup.id}` ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <ShieldCheck
                            data-icon="inline-start"
                            aria-hidden="true"
                          />
                        )}
                        점검
                      </Button>
                      <Button
                        type="button"
                        className="backup-row-action"
                        disabled={
                          busyKey !== null || backup.status !== "VERIFIED"
                        }
                        onClick={() => openRestore(backup)}
                      >
                        <ArchiveRestore
                          data-icon="inline-start"
                          aria-hidden="true"
                        />
                        복원
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <Dialog
        open={restoreBackup !== null}
        onOpenChange={(open) => {
          if (!open && busyKey === null) setRestoreBackup(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>백업 복원</DialogTitle>
            <DialogDescription>새 프로젝트로 복원</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="backup-restore-name">이름</FieldLabel>
              <Input
                id="backup-restore-name"
                value={restoreName}
                onChange={(event) => setRestoreName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="backup-restore-slug">Slug</FieldLabel>
              <Input
                id="backup-restore-slug"
                value={restoreSlug}
                onChange={(event) => setRestoreSlug(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="backup-restore-actions">
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                disabled={busyKey !== null}
              >
                취소
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={
                busyKey !== null ||
                restoreName.trim().length === 0 ||
                restoreSlug.trim().length === 0
              }
              onClick={() => void restore()}
            >
              {busyKey?.startsWith("restore:") ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <ArchiveRestore data-icon="inline-start" aria-hidden="true" />
              )}
              복원
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
