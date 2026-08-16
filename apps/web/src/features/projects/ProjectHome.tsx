import {
  ArchiveRestore,
  Boxes,
  ChevronRight,
  CircleAlert,
  Copy,
  Download,
  FolderClock,
  FolderHeart,
  Folders,
  Factory,
  Heart,
  LayoutDashboard,
  ListChecks,
  NotebookText,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  batchPurgeProjects,
  batchRestoreProjects,
  cloneProject,
  createReferenceApplications,
  createProject,
  createPurgePlan,
  exportProject,
  importProject,
  listProjects,
  listRecycleBinProjects,
  newIdempotencyKey,
  ProjectsApiError,
  purgeProject,
  restoreProject,
  trashProject,
  updateProject,
} from "@/services/projects-api";
import type {
  LifecycleBatchResult,
  ProjectDto,
  ProjectExportPayload,
  PurgePlanDto,
  ReferenceApplicationSuiteDto,
  RestoreConflictResolution,
} from "@/services/projects-api";
import { BackupManager } from "./BackupManager";

type HomeSection = "active" | "recent" | "favorites" | "trash" | "backup";
type SortOption = "updated" | "name";

interface ConflictNotice {
  operation: string;
  projectName: string;
  message: string;
}

const navItems = [
  { id: "active", label: "활성 프로젝트", icon: Folders },
  { id: "recent", label: "최근 작업", icon: FolderClock },
  { id: "favorites", label: "즐겨찾기", icon: FolderHeart },
  { id: "trash", label: "휴지통", icon: Trash2 },
  { id: "backup", label: "백업", icon: ArchiveRestore },
] as const;

const sectionTitles: Record<Exclude<HomeSection, "backup">, string> = {
  active: "프로젝트",
  recent: "최근",
  favorites: "즐겨찾기",
  trash: "휴지통",
};

function lifecycleLabel(status: ProjectDto["lifecycleStatus"]): string {
  const labels: Record<ProjectDto["lifecycleStatus"], string> = {
    ACTIVE: "활성",
    TRASHING: "이동 중",
    TRASHED: "휴지통",
    RESTORING: "복원 중",
    PURGING: "삭제 중",
    PURGE_FAILED: "영구 삭제 실패",
    PURGED: "삭제됨",
  };
  return labels[status];
}

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value?: string | null): string {
  if (!value) return "기록 없음";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function countFor(
  project: ProjectDto,
  flatKey:
    "pageCount" | "elementCount" | "bindingCount" | "tableCount" | "assetCount",
  nestedKey: "pages" | "elements" | "bindings" | "tables" | "assets",
): number {
  return project[flatKey] ?? project.counts?.[nestedKey] ?? 0;
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("파일을 읽지 못했습니다.")),
    );
    reader.readAsText(file);
  });
}

function parseProjectExport(value: unknown): ProjectExportPayload {
  const root =
    value !== null &&
    typeof value === "object" &&
    "export" in value &&
    value.export !== null &&
    typeof value.export === "object"
      ? value.export
      : value;
  if (
    root === null ||
    typeof root !== "object" ||
    !("format" in root) ||
    root.format !== "webeditor-project-v1" ||
    !("project" in root) ||
    root.project === null ||
    typeof root.project !== "object" ||
    !("name" in root.project) ||
    typeof root.project.name !== "string" ||
    !("slug" in root.project) ||
    typeof root.project.slug !== "string" ||
    !("manifest" in root) ||
    root.manifest === null ||
    typeof root.manifest !== "object" ||
    !("files" in root) ||
    !Array.isArray(root.files)
  ) {
    throw new Error("WebEditor 프로젝트 내보내기 파일이 아닙니다.");
  }
  return root as ProjectExportPayload;
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

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "프로젝트 요청을 처리하지 못했습니다.";
}

function batchResultErrors<T>(
  results: LifecycleBatchResult<T>[],
  projects: ProjectDto[],
): string[] {
  const resultById = new Map(
    results.map((result) => [result.projectId, result]),
  );
  return projects.flatMap((project) => {
    const result = resultById.get(project.id);
    if (result?.ok && result.value !== undefined) return [];
    return [
      `${project.name}: ${result?.error?.message ?? "서버가 완료 결과를 반환하지 않았습니다."}`,
    ];
  });
}

function ProjectCard({
  project,
  trashed,
  selected,
  busyAction,
  onOpen,
  onClone,
  onExport,
  onFavorite,
  onTrash,
  onDetails,
  onRestore,
  onPurge,
  onToggleSelected,
}: {
  project: ProjectDto;
  trashed: boolean;
  selected: boolean;
  busyAction: string | null;
  onOpen: () => void;
  onClone: () => void;
  onExport: () => void;
  onFavorite: () => void;
  onTrash: (trigger: HTMLButtonElement) => void;
  onDetails: () => void;
  onRestore: (trigger: HTMLButtonElement) => void;
  onPurge: (trigger: HTMLButtonElement) => void;
  onToggleSelected: (selected: boolean) => void;
}) {
  const restoreAllowed = project.lifecycleStatus === "TRASHED";
  const purgeAllowed =
    project.lifecycleStatus === "TRASHED" ||
    project.lifecycleStatus === "PURGE_FAILED";
  const referenceSample =
    project.slug === "feature-showcase" || project.slug.startsWith("sample-");

  return (
    <article className="project-card-shell">
      <Card className="project-card">
        <div className="project-card-accent" aria-hidden="true" />
        <CardHeader className="project-card-header">
          <span className="project-icon">
            <LayoutDashboard aria-hidden="true" />
          </span>
          <div className="project-card-heading">
            <CardTitle>
              <h2>{project.name}</h2>
            </CardTitle>
            <CardDescription>
              {project.description ?? "설명 없음"}
            </CardDescription>
          </div>
          {!trashed && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn("favorite-button", project.favorite && "is-active")}
              aria-label={`${project.name} ${project.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}`}
              aria-pressed={project.favorite}
              disabled={busyAction !== null}
              onClick={onFavorite}
            >
              {busyAction === "favorite" ? (
                <Spinner />
              ) : (
                <Heart aria-hidden="true" />
              )}
            </Button>
          )}
          {trashed && (
            <Checkbox
              aria-label={`${project.name} 선택`}
              checked={selected}
              onCheckedChange={(checked) => onToggleSelected(checked === true)}
            />
          )}
        </CardHeader>

        <CardContent className="project-card-content">
          <div className="project-identifiers">
            <Badge variant={trashed ? "destructive" : "secondary"}>
              {lifecycleLabel(project.lifecycleStatus)}
            </Badge>
            {referenceSample && <Badge variant="outline">예제</Badge>}
            <code>/{project.slug}</code>
          </div>
          <dl className="project-metadata">
            <div>
              <dt>페이지</dt>
              <dd>{countFor(project, "pageCount", "pages")}</dd>
            </div>
            <div>
              <dt>엘리먼트</dt>
              <dd>{countFor(project, "elementCount", "elements")}</dd>
            </div>
            <div>
              <dt>바인딩</dt>
              <dd>{countFor(project, "bindingCount", "bindings")}</dd>
            </div>
            <div>
              <dt>테이블</dt>
              <dd>{countFor(project, "tableCount", "tables")}</dd>
            </div>
            <div>
              <dt>에셋</dt>
              <dd>{countFor(project, "assetCount", "assets")}</dd>
            </div>
          </dl>
          <p className="project-updated">
            {trashed ? "삭제" : "저장"}{" "}
            {formatDate(trashed ? project.deletedAt : project.updatedAt)}
          </p>
          {project.lifecycleStatus === "PURGE_FAILED" && (
            <p className="purge-retry-note">영구 삭제 재시도만 가능</p>
          )}
        </CardContent>

        <CardFooter className="project-card-footer">
          {trashed ? (
            <div className="project-actions recycle-actions">
              <Button type="button" variant="outline" onClick={onDetails}>
                상세
              </Button>
              {restoreAllowed && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busyAction !== null}
                  onClick={(event) => onRestore(event.currentTarget)}
                >
                  {busyAction === "restore" ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <ArchiveRestore
                      data-icon="inline-start"
                      aria-hidden="true"
                    />
                  )}
                  복원
                </Button>
              )}
              <Button
                type="button"
                variant="destructive"
                disabled={busyAction !== null || !purgeAllowed}
                onClick={(event) => onPurge(event.currentTarget)}
              >
                {busyAction === "plan" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Trash2 data-icon="inline-start" aria-hidden="true" />
                )}
                영구 삭제
              </Button>
            </div>
          ) : (
            <div className="project-actions">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${project.name} 복제`}
                title="복제"
                disabled={busyAction !== null}
                onClick={onClone}
              >
                {busyAction === "clone" ? (
                  <Spinner />
                ) : (
                  <Copy aria-hidden="true" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${project.name} 내보내기`}
                title="내보내기"
                disabled={busyAction !== null}
                onClick={onExport}
              >
                {busyAction === "export" ? (
                  <Spinner />
                ) : (
                  <Download aria-hidden="true" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="destructive-ghost"
                aria-label={`${project.name} 휴지통으로 이동`}
                title="휴지통으로 이동"
                disabled={busyAction !== null}
                onClick={(event) => onTrash(event.currentTarget)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
              <Button
                type="button"
                disabled={busyAction !== null}
                onClick={onOpen}
              >
                열기
                <ChevronRight data-icon="inline-end" aria-hidden="true" />
              </Button>
            </div>
          )}
        </CardFooter>
      </Card>
    </article>
  );
}

function LoadingProjects() {
  return (
    <section className="project-grid" aria-label="프로젝트 불러오는 중">
      {[0, 1, 2].map((index) => (
        <Card className="project-card loading-project-card" key={index}>
          <CardHeader>
            <Skeleton className="size-12 rounded-xl" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-8 w-full" />
          </CardContent>
          <CardFooter>
            <Skeleton className="h-8 w-full" />
          </CardFooter>
        </Card>
      ))}
      <span className="sr-only" role="status">
        프로젝트 불러오는 중
      </span>
    </section>
  );
}

function CreateProjectDialog({
  themeId,
  onCreated,
}: {
  themeId: string;
  onCreated: (project: ProjectDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = name.trim().length < 2;

  const reset = () => {
    setName("");
    setDescription("");
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen && !submitting) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" className="project-entry-button">
          <Plus data-icon="inline-start" aria-hidden="true" />새 프로젝트
        </Button>
      </DialogTrigger>
      <DialogContent className="lifecycle-dialog">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (invalid || submitting) return;
            setSubmitting(true);
            setError(null);
            void createProject({
              name: name.trim(),
              description: description.trim(),
              themeId,
            })
              .then((project) => {
                onCreated(project);
                setOpen(false);
                reset();
              })
              .catch((reason: unknown) => setError(errorMessage(reason)))
              .finally(() => setSubmitting(false));
          }}
        >
          <DialogHeader>
            <DialogTitle>새 프로젝트</DialogTitle>
            <DialogDescription>현재 테마 적용</DialogDescription>
          </DialogHeader>
          <FieldGroup className="dialog-field-group">
            <Field data-invalid={name.length > 0 && invalid}>
              <FieldLabel htmlFor="project-name">프로젝트 이름</FieldLabel>
              <Input
                id="project-name"
                autoFocus
                value={name}
                aria-invalid={name.length > 0 && invalid}
                onChange={(event) => setName(event.target.value)}
              />
              <FieldDescription>두 글자 이상</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="project-description">설명</FieldLabel>
              <Textarea
                id="project-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>
                취소
              </Button>
            </DialogClose>
            <Button type="submit" disabled={invalid || submitting}>
              {submitting && <Spinner data-icon="inline-start" />}
              만들기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportProjectDialog({
  onImported,
}: {
  onImported: (project: ProjectDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const [exportPayload, setExportPayload] =
    useState<ProjectExportPayload | null>(null);
  const [filename, setFilename] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [reading, setReading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim());
  const invalid = exportPayload === null || !name.trim() || !validSlug;

  const reset = () => {
    setExportPayload(null);
    setFilename("");
    setName("");
    setSlug("");
    setReading(false);
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen && !submitting) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="project-entry-button"
        >
          <Upload data-icon="inline-start" aria-hidden="true" />
          프로젝트 가져오기
        </Button>
      </DialogTrigger>
      <DialogContent className="lifecycle-dialog">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (invalid || submitting || !exportPayload) return;
            setSubmitting(true);
            setError(null);
            void importProject(exportPayload, {
              name: name.trim(),
              slug: slug.trim(),
            })
              .then((project) => {
                onImported(project);
                setOpen(false);
                reset();
              })
              .catch((reason: unknown) => setError(errorMessage(reason)))
              .finally(() => setSubmitting(false));
          }}
        >
          <DialogHeader>
            <DialogTitle>프로젝트 가져오기</DialogTitle>
            <DialogDescription>새 프로젝트 · 덮어쓰기 없음</DialogDescription>
          </DialogHeader>
          <FieldGroup className="dialog-field-group">
            <Field>
              <FieldLabel htmlFor="project-import-file">
                프로젝트 JSON
              </FieldLabel>
              <Input
                id="project-import-file"
                type="file"
                accept="application/json,.json"
                disabled={reading || submitting}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setReading(true);
                  setError(null);
                  setExportPayload(null);
                  setFilename(file.name);
                  void readFileText(file)
                    .then((text) => parseProjectExport(JSON.parse(text)))
                    .then((payload) => {
                      const sourceName = payload.project.name.trim();
                      const sourceSlug = payload.project.slug.trim();
                      setExportPayload(payload);
                      setName(`${sourceName} 가져오기`.slice(0, 120));
                      setSlug(
                        `${sourceSlug.slice(0, 72).replace(/-+$/g, "")}-import`,
                      );
                    })
                    .catch((reason: unknown) => {
                      setError(errorMessage(reason));
                      setFilename("");
                    })
                    .finally(() => setReading(false));
                }}
              />
              <FieldDescription>
                {reading
                  ? "검사 중"
                  : filename
                    ? `${filename} 준비됨`
                    : ".json 파일"}
              </FieldDescription>
            </Field>
            {exportPayload && (
              <>
                <Field data-invalid={!name.trim()}>
                  <FieldLabel htmlFor="project-import-name">
                    새 프로젝트 이름
                  </FieldLabel>
                  <Input
                    id="project-import-name"
                    value={name}
                    aria-invalid={!name.trim()}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                <Field data-invalid={!validSlug}>
                  <FieldLabel htmlFor="project-import-slug">새 Slug</FieldLabel>
                  <Input
                    id="project-import-slug"
                    value={slug}
                    aria-invalid={!validSlug}
                    onChange={(event) => setSlug(event.target.value)}
                  />
                  <FieldDescription>소문자·숫자·하이픈</FieldDescription>
                </Field>
              </>
            )}
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>
                취소
              </Button>
            </DialogClose>
            <Button type="submit" disabled={invalid || reading || submitting}>
              {submitting && <Spinner data-icon="inline-start" />}
              가져오기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const referenceApplicationItems = [
  {
    kind: "SEMICONDUCTOR_YIELD",
    name: "반도체 수율",
    detail: "로트·웨이퍼·불량·경보",
    rows: 600,
    icon: Factory,
  },
  {
    kind: "COMMERCE_OPERATIONS",
    name: "쇼핑몰 운영",
    detail: "상품·주문·재고·결제",
    rows: 1_370,
    icon: ShoppingCart,
  },
  {
    kind: "PERSONAL_BLOG",
    name: "개인 블로그",
    detail: "글·댓글·조회·구독",
    rows: 1_012,
    icon: NotebookText,
  },
  {
    kind: "WORK_MANAGEMENT",
    name: "업무 관리",
    detail: "프로젝트·업무·시간",
    rows: 956,
    icon: ListChecks,
  },
] as const;

function ReferenceApplicationsDialog({
  onGenerated,
}: {
  onGenerated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [suite, setSuite] = useState<ReferenceApplicationSuiteDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSuite(null);
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (submitting) return;
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="project-entry-button"
        >
          <Boxes data-icon="inline-start" aria-hidden="true" />
          예제 프로젝트
        </Button>
      </DialogTrigger>
      <DialogContent className="lifecycle-dialog reference-applications-dialog">
        <DialogHeader>
          <DialogTitle>예제 프로젝트</DialogTitle>
          <DialogDescription>
            4개 시스템 · 실제 데이터 3,938건
          </DialogDescription>
        </DialogHeader>
        <div className="reference-application-grid">
          {referenceApplicationItems.map((item) => {
            const Icon = item.icon;
            const generated = suite?.projects.find(
              ({ kind }) => kind === item.kind,
            );
            return (
              <Card key={item.kind} className="reference-application-card">
                <CardHeader>
                  <Icon aria-hidden="true" />
                  <CardTitle>{item.name}</CardTitle>
                  <CardDescription>{item.detail}</CardDescription>
                </CardHeader>
                <CardContent>
                  <span>{item.rows.toLocaleString("ko-KR")}건</span>
                  <Badge variant={generated ? "secondary" : "outline"}>
                    {generated ? "준비됨" : "Test + Production"}
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {suite && (
          <Alert>
            <Boxes aria-hidden="true" />
            <AlertTitle>예제 4개 준비됨</AlertTitle>
            <AlertDescription>
              페이지·차트·테이블·CRUD·백업 연결 완료
            </AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>생성 실패</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={submitting}>
              {suite ? "닫기" : "취소"}
            </Button>
          </DialogClose>
          {!suite && (
            <Button
              type="button"
              disabled={submitting}
              onClick={() => {
                setSubmitting(true);
                setError(null);
                void createReferenceApplications()
                  .then(async (result) => {
                    setSuite(result);
                    await onGenerated();
                  })
                  .catch((reason: unknown) => setError(errorMessage(reason)))
                  .finally(() => setSubmitting(false));
              }}
            >
              {submitting && <Spinner data-icon="inline-start" />}
              {submitting ? "준비 중" : "4개 만들기"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectHome({
  headerBrand,
  headerControls,
  themeId,
  onOpenProject,
}: {
  headerBrand: ReactNode;
  headerControls: ReactNode;
  themeId: string;
  onOpenProject: (project: ProjectDto) => void;
}) {
  const [activeProjects, setActiveProjects] = useState<ProjectDto[]>([]);
  const [recycleProjects, setRecycleProjects] = useState<ProjectDto[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictNotice | null>(null);
  const [section, setSection] = useState<HomeSection>("active");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOption>("updated");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedRecycleIds, setSelectedRecycleIds] = useState<string[]>([]);
  const [batchRestoreOpen, setBatchRestoreOpen] = useState(false);
  const [batchRestoreErrors, setBatchRestoreErrors] = useState<string[]>([]);
  const batchRestoreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [batchPurgeOpen, setBatchPurgeOpen] = useState(false);
  const [batchPurgeTargets, setBatchPurgeTargets] = useState<ProjectDto[]>([]);
  const [batchPurgePlans, setBatchPurgePlans] = useState<
    Record<string, PurgePlanDto>
  >({});
  const [batchPurgeConfirmations, setBatchPurgeConfirmations] = useState<
    Record<string, string>
  >({});
  const [batchPurgeErrors, setBatchPurgeErrors] = useState<string[]>([]);
  const [batchBackupBeforePurge, setBatchBackupBeforePurge] = useState(true);
  const batchPurgeTriggerRef = useRef<HTMLButtonElement | null>(null);

  const [trashTarget, setTrashTarget] = useState<ProjectDto | null>(null);
  const [trashReason, setTrashReason] = useState("user-request");
  const trashTriggerRef = useRef<HTMLButtonElement | null>(null);

  const [detailTarget, setDetailTarget] = useState<ProjectDto | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<ProjectDto | null>(null);
  const [restoreStrategy, setRestoreStrategy] =
    useState<RestoreConflictResolution>("KEEP_ORIGINAL");
  const [restoreName, setRestoreName] = useState("");
  const [restoreSlug, setRestoreSlug] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const restoreTriggerRef = useRef<HTMLButtonElement | null>(null);

  const [purgeTarget, setPurgeTarget] = useState<ProjectDto | null>(null);
  const [purgePlan, setPurgePlan] = useState<PurgePlanDto | null>(null);
  const [purgePlanError, setPurgePlanError] = useState<string | null>(null);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [backupBeforePurge, setBackupBeforePurge] = useState(true);
  const purgeTriggerRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(
    async (options: { preserveActionError?: boolean } = {}) => {
      setLoadState("loading");
      setLoadError("");
      if (!options.preserveActionError) setActionError(null);
      try {
        const [active, recycle] = await Promise.all([
          listProjects(),
          listRecycleBinProjects(),
        ]);
        setActiveProjects(active);
        setRecycleProjects(recycle);
        setLoadState("ready");
      } catch (error) {
        setLoadError(errorMessage(error));
        setLoadState("error");
      }
    },
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const availableIds = new Set(recycleProjects.map((project) => project.id));
    setSelectedRecycleIds((current) =>
      current.filter((projectId) => availableIds.has(projectId)),
    );
  }, [recycleProjects]);

  const reportMutationError = (
    error: unknown,
    operation: string,
    project: ProjectDto,
  ) => {
    if (error instanceof ProjectsApiError && error.status === 409) {
      setConflict({
        operation,
        projectName: project.name,
        message: error.message,
      });
      return;
    }
    setActionError(errorMessage(error));
  };

  const counts: Record<HomeSection, number | null> = {
    active: activeProjects.length,
    recent: activeProjects.length,
    favorites: activeProjects.filter((project) => project.favorite).length,
    trash: recycleProjects.length,
    backup: null,
  };

  const visibleProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko");
    let projects = section === "trash" ? recycleProjects : activeProjects;
    if (section === "favorites") {
      projects = projects.filter((project) => project.favorite);
    }
    if (normalizedQuery) {
      projects = projects.filter((project) =>
        `${project.name} ${project.description ?? ""} ${project.slug}`
          .toLocaleLowerCase("ko")
          .includes(normalizedQuery),
      );
    }
    return [...projects].sort((left, right) => {
      if (sort === "name") return left.name.localeCompare(right.name, "ko");
      const leftDate = new Date(
        section === "trash"
          ? (left.deletedAt ?? left.updatedAt)
          : left.updatedAt,
      ).getTime();
      const rightDate = new Date(
        section === "trash"
          ? (right.deletedAt ?? right.updatedAt)
          : right.updatedAt,
      ).getTime();
      return rightDate - leftDate;
    });
  }, [activeProjects, query, recycleProjects, section, sort]);

  const selectedRecycleProjects = useMemo(() => {
    const selected = new Set(selectedRecycleIds);
    return recycleProjects.filter((project) => selected.has(project.id));
  }, [recycleProjects, selectedRecycleIds]);

  const selectedRecycleProjectsRestorable = selectedRecycleProjects.every(
    (project) => project.lifecycleStatus === "TRASHED",
  );
  const selectedRecycleProjectsPurgeable = selectedRecycleProjects.every(
    (project) =>
      project.lifecycleStatus === "TRASHED" ||
      project.lifecycleStatus === "PURGE_FAILED",
  );

  const allVisibleRecycleSelected =
    section === "trash" &&
    visibleProjects.length > 0 &&
    visibleProjects.every((project) => selectedRecycleIds.includes(project.id));

  const activeBusyAction = (projectId: string): string | null => {
    const prefix = `${projectId}:`;
    return busyKey?.startsWith(prefix) ? busyKey.slice(prefix.length) : null;
  };

  const handleFavorite = async (project: ProjectDto) => {
    setBusyKey(`${project.id}:favorite`);
    setActionError(null);
    try {
      const updated = await updateProject(project.id, {
        expectedRevision: project.revision,
        favorite: !project.favorite,
      });
      setActiveProjects((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        ),
      );
    } catch (error) {
      reportMutationError(error, "즐겨찾기 변경", project);
    } finally {
      setBusyKey(null);
    }
  };

  const handleClone = async (project: ProjectDto) => {
    setBusyKey(`${project.id}:clone`);
    setActionError(null);
    try {
      const clone = await cloneProject(project.id);
      setActiveProjects((current) => [clone, ...current]);
    } catch (error) {
      reportMutationError(error, "프로젝트 복제", project);
    } finally {
      setBusyKey(null);
    }
  };

  const handleExport = async (project: ProjectDto) => {
    setBusyKey(`${project.id}:export`);
    setActionError(null);
    try {
      const exported = await exportProject(project.id);
      const url = URL.createObjectURL(exported.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exported.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      reportMutationError(error, "프로젝트 내보내기", project);
    } finally {
      setBusyKey(null);
    }
  };

  const handleTrash = async () => {
    if (!trashTarget) return;
    setBusyKey(`${trashTarget.id}:trash`);
    setActionError(null);
    try {
      const trashed = await trashProject(trashTarget.id, {
        expectedRevision: trashTarget.revision,
        expectedLifecycleRevision: trashTarget.lifecycleRevision,
        idempotencyKey: newIdempotencyKey("trash"),
        reason: trashReason,
      });
      setActiveProjects((current) =>
        current.filter((project) => project.id !== trashTarget.id),
      );
      setRecycleProjects((current) => [trashed, ...current]);
      setTrashTarget(null);
    } catch (error) {
      reportMutationError(error, "휴지통 이동", trashTarget);
      if (!(error instanceof ProjectsApiError && error.status === 409)) {
        setTrashTarget(null);
        await load({ preserveActionError: true });
      }
    } finally {
      setBusyKey(null);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    const replacesName = restoreStrategy !== "KEEP_ORIGINAL";
    const invalidName = replacesName && !restoreName.trim();
    const invalidSlug = restoreStrategy === "NEW_SLUG" && !restoreSlug.trim();
    if (invalidName || invalidSlug) return;
    setBusyKey(`${restoreTarget.id}:restore`);
    setRestoreError(null);
    setActionError(null);
    try {
      const restored = await restoreProject(restoreTarget.id, {
        expectedLifecycleRevision: restoreTarget.lifecycleRevision,
        idempotencyKey: newIdempotencyKey("restore"),
        conflictResolution: restoreStrategy,
        ...(replacesName ? { name: restoreName.trim() } : {}),
        ...(restoreStrategy === "NEW_SLUG" ? { slug: restoreSlug.trim() } : {}),
      });
      setRecycleProjects((current) =>
        current.filter((project) => project.id !== restoreTarget.id),
      );
      setActiveProjects((current) => [restored, ...current]);
      setRestoreTarget(null);
    } catch (error) {
      if (error instanceof ProjectsApiError && error.status === 409) {
        setRestoreError(error.message);
        setConflict({
          operation: "프로젝트 복원",
          projectName: restoreTarget.name,
          message: error.message,
        });
      } else {
        const message = errorMessage(error);
        setRestoreError(message);
        setActionError(message);
        setRestoreTarget(null);
        await load({ preserveActionError: true });
      }
    } finally {
      setBusyKey(null);
    }
  };

  const handleBatchRestore = async () => {
    const targets = selectedRecycleProjects.filter(
      (project) => project.lifecycleStatus === "TRASHED",
    );
    if (targets.length === 0) return;
    setBusyKey("batch:restore");
    setBatchRestoreErrors([]);
    setActionError(null);
    try {
      const results = await batchRestoreProjects(
        targets.map((project) => ({
          projectId: project.id,
          expectedLifecycleRevision: project.lifecycleRevision,
          idempotencyKey: newIdempotencyKey("batch-restore"),
          conflictResolution: "KEEP_ORIGINAL",
        })),
      );
      const restored = results.flatMap((result) =>
        result.ok && result.value ? [result.value] : [],
      );
      const restoredIds = new Set(restored.map((project) => project.id));
      const failures = batchResultErrors(results, targets);
      setRecycleProjects((current) =>
        current.filter((project) => !restoredIds.has(project.id)),
      );
      setActiveProjects((current) => [...restored, ...current]);
      setSelectedRecycleIds(
        targets
          .filter((project) => !restoredIds.has(project.id))
          .map((project) => project.id),
      );
      setBatchRestoreErrors(failures);
      if (failures.length === 0) {
        setBatchRestoreOpen(false);
      } else {
        setActionError(failures.join(" · "));
        await load({ preserveActionError: true });
      }
    } catch (error) {
      const message = errorMessage(error);
      setBatchRestoreErrors([message]);
      setActionError(message);
      await load({ preserveActionError: true });
    } finally {
      setBusyKey(null);
    }
  };

  const openBatchPurgePlans = (
    projects: ProjectDto[],
    trigger: HTMLButtonElement,
  ) => {
    if (projects.length === 0) return;
    batchPurgeTriggerRef.current = trigger;
    setBatchPurgeOpen(true);
    setBatchPurgeTargets(projects);
    setBatchPurgePlans({});
    setBatchPurgeConfirmations({});
    setBatchPurgeErrors([]);
    setBatchBackupBeforePurge(true);
    setBusyKey("batch:plan");
    void Promise.allSettled(
      projects.map(async (project) => ({
        project,
        plan: await createPurgePlan(project.id, project.lifecycleRevision),
      })),
    )
      .then((outcomes) => {
        const plans: Record<string, PurgePlanDto> = {};
        const errors: string[] = [];
        outcomes.forEach((outcome, index) => {
          const project = projects[index];
          if (!project) return;
          if (outcome.status === "fulfilled") {
            plans[project.id] = outcome.value.plan;
          } else {
            errors.push(`${project.name}: ${errorMessage(outcome.reason)}`);
          }
        });
        setBatchPurgePlans(plans);
        setBatchPurgeErrors(errors);
      })
      .finally(() => setBusyKey(null));
  };

  const handleBatchPurge = async () => {
    if (batchPurgeTargets.length === 0) return;
    const plans = batchPurgeTargets.map(
      (project) => batchPurgePlans[project.id],
    );
    if (plans.some((plan) => plan === undefined)) return;
    setBusyKey("batch:purge");
    setBatchPurgeErrors([]);
    try {
      const results = await batchPurgeProjects(
        batchPurgeTargets.map((project) => {
          const plan = batchPurgePlans[project.id];
          if (!plan) {
            throw new Error(`${project.name}의 영구 삭제 계획이 없습니다.`);
          }
          return {
            projectId: project.id,
            purgePlanId: plan.purgePlanId,
            expectedLifecycleRevision: plan.lifecycleRevision,
            typedConfirmation: batchPurgeConfirmations[project.id] ?? "",
            idempotencyKey: newIdempotencyKey("batch-purge"),
            backupBeforePurge: batchBackupBeforePurge,
          };
        }),
      );
      const successfulIds = new Set(
        results
          .filter((result) => result.ok && result.value !== undefined)
          .map((result) => result.projectId),
      );
      const failures = batchResultErrors(results, batchPurgeTargets);
      setRecycleProjects((current) =>
        current.filter((project) => !successfulIds.has(project.id)),
      );
      const remainingTargets = batchPurgeTargets.filter(
        (project) => !successfulIds.has(project.id),
      );
      setSelectedRecycleIds(remainingTargets.map((project) => project.id));
      setBatchPurgeTargets(remainingTargets);
      setBatchPurgeErrors(failures);
      if (failures.length === 0) {
        setBatchPurgeOpen(false);
        setBatchPurgePlans({});
      } else {
        setActionError(failures.join(" · "));
        await load({ preserveActionError: true });
      }
    } catch (error) {
      const message = errorMessage(error);
      setBatchPurgeErrors([message]);
      setActionError(message);
      await load({ preserveActionError: true });
    } finally {
      setBusyKey(null);
    }
  };

  const openPurgePlan = (project: ProjectDto, trigger: HTMLButtonElement) => {
    purgeTriggerRef.current = trigger;
    setPurgeTarget(project);
    setPurgePlan(null);
    setPurgePlanError(null);
    setTypedConfirmation("");
    setBackupBeforePurge(true);
    setBusyKey(`${project.id}:plan`);
    void createPurgePlan(project.id, project.lifecycleRevision)
      .then(setPurgePlan)
      .catch((error: unknown) => setPurgePlanError(errorMessage(error)))
      .finally(() => setBusyKey(null));
  };

  const handlePurge = async () => {
    if (!purgeTarget || !purgePlan) return;
    setBusyKey(`${purgeTarget.id}:purge`);
    setPurgePlanError(null);
    try {
      await purgeProject(purgeTarget.id, {
        purgePlanId: purgePlan.purgePlanId,
        expectedLifecycleRevision: purgePlan.lifecycleRevision,
        typedConfirmation,
        idempotencyKey: newIdempotencyKey("purge"),
        backupBeforePurge,
      });
      setRecycleProjects((current) =>
        current.filter((project) => project.id !== purgeTarget.id),
      );
      setPurgeTarget(null);
      setPurgePlan(null);
    } catch (error) {
      if (error instanceof ProjectsApiError && error.status === 409) {
        setConflict({
          operation: "영구 삭제",
          projectName: purgeTarget.name,
          message: error.message,
        });
      }
      setPurgePlanError(errorMessage(error));
      if (!(error instanceof ProjectsApiError && error.status === 409)) {
        setPurgeTarget(null);
        setPurgePlan(null);
        setActionError(errorMessage(error));
        await load({ preserveActionError: true });
      }
    } finally {
      setBusyKey(null);
    }
  };

  const exportAll = async () => {
    for (const project of activeProjects) {
      await handleExport(project);
    }
  };

  return (
    <div className="surface home-surface">
      <header className="app-header">
        {headerBrand}
        <div className="header-location">
          <strong>프로젝트</strong>
        </div>
        {headerControls}
      </header>

      <div className="home-layout">
        <aside className="home-sidebar">
          <nav aria-label="프로젝트 홈">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.id}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "sidebar-nav-item",
                    section === item.id && "is-active",
                  )}
                  aria-current={section === item.id ? "page" : undefined}
                  onClick={() => setSection(item.id)}
                >
                  <Icon data-icon="inline-start" aria-hidden="true" />
                  <span>{item.label}</span>
                  {counts[item.id] !== null && (
                    <span className="nav-count">{counts[item.id]}</span>
                  )}
                </Button>
              );
            })}
          </nav>
        </aside>

        <main className="home-main">
          {loadState === "error" ? (
            <Empty className="load-error-state">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CircleAlert aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>불러오기 실패</EmptyTitle>
                <EmptyDescription>{loadError}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button type="button" onClick={() => void load()}>
                  <RefreshCw data-icon="inline-start" aria-hidden="true" />
                  다시 시도
                </Button>
              </EmptyContent>
            </Empty>
          ) : section === "backup" ? (
            <section className="backup-panel" aria-labelledby="backup-title">
              <Card className="backup-card">
                <CardHeader>
                  <span className="backup-icon">
                    <ArchiveRestore aria-hidden="true" />
                  </span>
                  <CardTitle id="backup-title">백업</CardTitle>
                  <CardDescription>내보내기·가져오기</CardDescription>
                </CardHeader>
                <CardContent>
                  <BackupManager
                    projects={activeProjects}
                    onRestored={(project) =>
                      setActiveProjects((current) => [project, ...current])
                    }
                  />
                </CardContent>
                <CardFooter>
                  <ImportProjectDialog
                    onImported={(project) =>
                      setActiveProjects((current) => [project, ...current])
                    }
                  />
                  <Button
                    type="button"
                    disabled={activeProjects.length === 0 || busyKey !== null}
                    onClick={() => void exportAll()}
                  >
                    <Download data-icon="inline-start" aria-hidden="true" />
                    모두 내보내기
                  </Button>
                </CardFooter>
              </Card>
            </section>
          ) : (
            <>
              <section className="home-hero" aria-labelledby="home-title">
                <div>
                  <h1 id="home-title">{sectionTitles[section]}</h1>
                </div>
                {section !== "trash" && (
                  <div className="home-hero-actions">
                    <ReferenceApplicationsDialog onGenerated={() => load()} />
                    <ImportProjectDialog
                      onImported={(project) =>
                        setActiveProjects((current) => [project, ...current])
                      }
                    />
                    <CreateProjectDialog
                      themeId={themeId}
                      onCreated={(project) =>
                        setActiveProjects((current) => [project, ...current])
                      }
                    />
                  </div>
                )}
              </section>

              {conflict && (
                <Alert variant="destructive" className="lifecycle-alert">
                  <ShieldAlert aria-hidden="true" />
                  <AlertTitle>서버 상태 충돌</AlertTitle>
                  <AlertDescription>
                    {conflict.projectName} · {conflict.operation}:{" "}
                    {conflict.message}
                  </AlertDescription>
                  <AlertAction>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setConflict(null);
                        void load();
                      }}
                    >
                      최신 상태 불러오기
                    </Button>
                  </AlertAction>
                </Alert>
              )}
              {actionError && (
                <Alert variant="destructive" className="lifecycle-alert">
                  <CircleAlert aria-hidden="true" />
                  <AlertTitle>작업 실패</AlertTitle>
                  <AlertDescription>{actionError}</AlertDescription>
                </Alert>
              )}

              <div className="project-toolbar">
                <label className="search-field">
                  <Search aria-hidden="true" />
                  <span className="sr-only">프로젝트 검색</span>
                  <Input
                    type="search"
                    value={query}
                    placeholder="이름·설명·Slug 검색"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="검색어 지우기"
                      onClick={() => setQuery("")}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  )}
                </label>
                <NativeSelect
                  className="sort-field"
                  aria-label="프로젝트 정렬"
                  value={sort}
                  onChange={(event) =>
                    setSort(event.target.value as SortOption)
                  }
                >
                  <NativeSelectOption value="updated">
                    {section === "trash" ? "최근 삭제순" : "최근 저장순"}
                  </NativeSelectOption>
                  <NativeSelectOption value="name">이름순</NativeSelectOption>
                </NativeSelect>
              </div>

              {section === "trash" && loadState === "ready" && (
                <div className="recycle-selection-toolbar">
                  <Field orientation="horizontal">
                    <Checkbox
                      id="select-visible-recycle-projects"
                      checked={allVisibleRecycleSelected}
                      disabled={visibleProjects.length === 0}
                      onCheckedChange={(checked) => {
                        const visibleIds = new Set(
                          visibleProjects.map((project) => project.id),
                        );
                        setSelectedRecycleIds((current) =>
                          checked === true
                            ? [...new Set([...current, ...visibleIds])]
                            : current.filter(
                                (projectId) => !visibleIds.has(projectId),
                              ),
                        );
                      }}
                    />
                    <FieldLabel htmlFor="select-visible-recycle-projects">
                      표시된 프로젝트 모두 선택
                    </FieldLabel>
                  </Field>
                  <span className="selection-count" role="status">
                    {selectedRecycleProjects.length}개 선택
                  </span>
                  <div className="selection-actions">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        selectedRecycleProjects.length === 0 ||
                        !selectedRecycleProjectsRestorable ||
                        busyKey !== null
                      }
                      onClick={(event) => {
                        batchRestoreTriggerRef.current = event.currentTarget;
                        setBatchRestoreErrors([]);
                        setBatchRestoreOpen(true);
                      }}
                    >
                      <ArchiveRestore
                        data-icon="inline-start"
                        aria-hidden="true"
                      />
                      선택 복원
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={
                        selectedRecycleProjects.length === 0 ||
                        !selectedRecycleProjectsPurgeable ||
                        busyKey !== null
                      }
                      onClick={(event) =>
                        openBatchPurgePlans(
                          selectedRecycleProjects,
                          event.currentTarget,
                        )
                      }
                    >
                      <Trash2 data-icon="inline-start" aria-hidden="true" />
                      선택 영구 삭제
                    </Button>
                  </div>
                </div>
              )}

              {loadState === "loading" ? (
                <LoadingProjects />
              ) : visibleProjects.length === 0 ? (
                <Empty className="project-empty-state">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Search aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>프로젝트 없음</EmptyTitle>
                    <EmptyDescription>
                      {query
                        ? "검색 결과 없음"
                        : section === "trash"
                          ? "휴지통 비어 있음"
                          : "새 프로젝트 만들기"}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <section className="project-grid" aria-label="프로젝트 목록">
                  {visibleProjects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      trashed={section === "trash"}
                      selected={selectedRecycleIds.includes(project.id)}
                      busyAction={activeBusyAction(project.id)}
                      onOpen={() => onOpenProject(project)}
                      onClone={() => void handleClone(project)}
                      onExport={() => void handleExport(project)}
                      onFavorite={() => void handleFavorite(project)}
                      onTrash={(trigger) => {
                        trashTriggerRef.current = trigger;
                        setTrashReason("user-request");
                        setTrashTarget(project);
                      }}
                      onDetails={() => setDetailTarget(project)}
                      onRestore={(trigger) => {
                        restoreTriggerRef.current = trigger;
                        setRestoreStrategy("KEEP_ORIGINAL");
                        setRestoreName(`${project.name} 복원본`);
                        setRestoreSlug(`${project.slug}-restored`);
                        setRestoreError(null);
                        setRestoreTarget(project);
                      }}
                      onPurge={(trigger) => openPurgePlan(project, trigger)}
                      onToggleSelected={(selected) =>
                        setSelectedRecycleIds((current) =>
                          selected
                            ? [...new Set([...current, project.id])]
                            : current.filter(
                                (projectId) => projectId !== project.id,
                              ),
                        )
                      }
                    />
                  ))}
                </section>
              )}
            </>
          )}
        </main>
      </div>

      <Dialog
        open={batchRestoreOpen}
        onOpenChange={(open) => {
          setBatchRestoreOpen(open);
          if (!open) setBatchRestoreErrors([]);
        }}
      >
        <DialogContent
          className="lifecycle-dialog"
          onCloseAutoFocus={(event) => {
            if (batchRestoreTriggerRef.current?.isConnected) {
              event.preventDefault();
              batchRestoreTriggerRef.current.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>선택 복원</DialogTitle>
            <DialogDescription>
              원래 이름·Slug로 복원합니다. 충돌 항목은 휴지통에 남습니다.
            </DialogDescription>
          </DialogHeader>
          <ul className="batch-project-list">
            {selectedRecycleProjects.map((project) => (
              <li key={project.id}>
                <strong>{project.name}</strong>
                <code>/{project.slug}</code>
              </li>
            ))}
          </ul>
          {batchRestoreErrors.length > 0 && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>일부 복원 실패</AlertTitle>
              <AlertDescription>
                <ul className="batch-error-list">
                  {batchRestoreErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                disabled={busyKey === "batch:restore"}
              >
                취소
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={
                selectedRecycleProjects.length === 0 ||
                busyKey === "batch:restore"
              }
              onClick={() => void handleBatchRestore()}
            >
              {busyKey === "batch:restore" && (
                <Spinner data-icon="inline-start" />
              )}
              복원
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={batchPurgeOpen}
        onOpenChange={(open) => {
          setBatchPurgeOpen(open);
          if (!open) {
            setBatchPurgeTargets([]);
            setBatchPurgePlans({});
            setBatchPurgeConfirmations({});
            setBatchPurgeErrors([]);
          }
        }}
      >
        <AlertDialogContent
          className="dialog lifecycle-dialog batch-purge-dialog"
          onCloseAutoFocus={(event) => {
            if (batchPurgeTriggerRef.current?.isConnected) {
              event.preventDefault();
              batchPurgeTriggerRef.current.focus();
            }
          }}
        >
          <AlertDialogMedia className="dialog-icon destructive">
            <ShieldAlert aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogHeader>
            <AlertDialogTitle>선택 영구 삭제</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            각 프로젝트 이름을 정확히 입력하세요. 삭제 후 복원할 수 없습니다.
          </AlertDialogDescription>
          {busyKey === "batch:plan" && (
            <div className="purge-plan-loading" role="status">
              <Spinner /> 삭제 계획 계산 중
            </div>
          )}
          {batchPurgeErrors.length > 0 && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>영구 삭제 확인 필요</AlertTitle>
              <AlertDescription>
                <ul className="batch-error-list">
                  {batchPurgeErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <div className="batch-purge-projects">
            {batchPurgeTargets.map((project) => {
              const plan = batchPurgePlans[project.id];
              const confirmation = batchPurgeConfirmations[project.id] ?? "";
              return (
                <section key={project.id} className="batch-purge-project">
                  <div className="batch-purge-heading">
                    <strong>{project.name}</strong>
                    <code>/{project.slug}</code>
                  </div>
                  {plan ? (
                    <>
                      <p>
                        Metadata {plan.metadataRecordCount} · 파일{" "}
                        {plan.fileCount}개 · {formatBytes(plan.estimatedBytes)}
                      </p>
                      {plan.blockers.length > 0 && (
                        <FieldError>
                          차단 조건: {plan.blockers.join(" · ")}
                        </FieldError>
                      )}
                      <Field
                        data-invalid={
                          confirmation.length > 0 &&
                          confirmation !== project.name
                        }
                      >
                        <FieldLabel htmlFor={`batch-purge-${project.id}`}>
                          “{project.name}” 정확히 입력
                        </FieldLabel>
                        <Input
                          id={`batch-purge-${project.id}`}
                          value={confirmation}
                          autoComplete="off"
                          aria-invalid={
                            confirmation.length > 0 &&
                            confirmation !== project.name
                          }
                          onChange={(event) =>
                            setBatchPurgeConfirmations((current) => ({
                              ...current,
                              [project.id]: event.target.value,
                            }))
                          }
                        />
                      </Field>
                    </>
                  ) : (
                    <p className="batch-plan-pending">계획 대기</p>
                  )}
                </section>
              );
            })}
          </div>
          <FieldSet>
            <FieldLegend variant="label">최종 백업</FieldLegend>
            <Field orientation="horizontal">
              <Checkbox
                id="batch-backup-before-purge"
                checked={batchBackupBeforePurge}
                onCheckedChange={(checked) =>
                  setBatchBackupBeforePurge(checked === true)
                }
              />
              <FieldLabel htmlFor="batch-backup-before-purge">
                삭제 전 프로젝트별 백업
              </FieldLabel>
            </Field>
          </FieldSet>
          <AlertDialogFooter>
            <AlertDialogCancel
              variant="outline"
              disabled={busyKey === "batch:purge"}
            >
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={
                batchPurgeTargets.length === 0 ||
                batchPurgeTargets.some((project) => {
                  const plan = batchPurgePlans[project.id];
                  return (
                    !plan ||
                    plan.blockers.length > 0 ||
                    batchPurgeConfirmations[project.id] !== project.name
                  );
                }) ||
                busyKey === "batch:plan" ||
                busyKey === "batch:purge"
              }
              onClick={(event) => {
                event.preventDefault();
                void handleBatchPurge();
              }}
            >
              {busyKey === "batch:purge" && (
                <Spinner data-icon="inline-start" />
              )}
              영구 삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={trashTarget !== null}
        onOpenChange={(open) => {
          if (!open) setTrashTarget(null);
        }}
      >
        {trashTarget && (
          <AlertDialogContent
            className="dialog lifecycle-dialog"
            onCloseAutoFocus={(event) => {
              if (trashTriggerRef.current?.isConnected) {
                event.preventDefault();
                trashTriggerRef.current.focus();
              }
            }}
          >
            <AlertDialogMedia className="dialog-icon destructive">
              <Trash2 aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogHeader>
              <AlertDialogTitle>휴지통 이동</AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogDescription>
              <strong>{trashTarget.name}</strong>의 편집·실행이 중단됩니다.
              데이터는 휴지통에 보존됩니다.
            </AlertDialogDescription>
            <dl className="impact-summary impact-summary-five">
              <div>
                <dt>페이지</dt>
                <dd>{countFor(trashTarget, "pageCount", "pages")}</dd>
              </div>
              <div>
                <dt>엘리먼트</dt>
                <dd>{countFor(trashTarget, "elementCount", "elements")}</dd>
              </div>
              <div>
                <dt>바인딩</dt>
                <dd>{countFor(trashTarget, "bindingCount", "bindings")}</dd>
              </div>
              <div>
                <dt>테이블</dt>
                <dd>{countFor(trashTarget, "tableCount", "tables")}</dd>
              </div>
              <div>
                <dt>에셋</dt>
                <dd>{countFor(trashTarget, "assetCount", "assets")}</dd>
              </div>
            </dl>
            <Field>
              <FieldLabel htmlFor="trash-reason">이동 사유</FieldLabel>
              <NativeSelect
                id="trash-reason"
                className="w-full"
                value={trashReason}
                onChange={(event) => setTrashReason(event.target.value)}
              >
                <NativeSelectOption value="user-request">
                  사용자 요청
                </NativeSelectOption>
                <NativeSelectOption value="duplicate">
                  중복 프로젝트
                </NativeSelectOption>
                <NativeSelectOption value="completed">
                  작업 종료
                </NativeSelectOption>
              </NativeSelect>
            </Field>
            <AlertDialogFooter className="dialog-actions">
              <AlertDialogCancel variant="outline" disabled={busyKey !== null}>
                취소
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={busyKey !== null}
                onClick={(event) => {
                  event.preventDefault();
                  void handleTrash();
                }}
              >
                {busyKey === `${trashTarget.id}:trash` ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Trash2 data-icon="inline-start" aria-hidden="true" />
                )}
                이동
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      <Dialog
        open={detailTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDetailTarget(null);
        }}
      >
        {detailTarget && (
          <DialogContent className="lifecycle-dialog">
            <DialogHeader>
              <DialogTitle>{detailTarget.name}</DialogTitle>
              <DialogDescription>읽기 전용</DialogDescription>
            </DialogHeader>
            <dl className="recycle-detail-list">
              <div>
                <dt>원래 Slug</dt>
                <dd>/{detailTarget.slug}</dd>
              </div>
              <div>
                <dt>삭제 시각</dt>
                <dd>{formatDate(detailTarget.deletedAt)}</dd>
              </div>
              <div>
                <dt>삭제 사유</dt>
                <dd>{detailTarget.deletedReason ?? "기록 없음"}</dd>
              </div>
              <div>
                <dt>수명 주기 버전</dt>
                <dd>{detailTarget.lifecycleRevision}</dd>
              </div>
              <div>
                <dt>정의 버전</dt>
                <dd>{detailTarget.revision}</dd>
              </div>
              <div>
                <dt>프로젝트 상태</dt>
                <dd>{detailTarget.status}</dd>
              </div>
              <div>
                <dt>규모</dt>
                <dd>
                  페이지 {countFor(detailTarget, "pageCount", "pages")} ·
                  엘리먼트 {countFor(detailTarget, "elementCount", "elements")}{" "}
                  · 바인딩 {countFor(detailTarget, "bindingCount", "bindings")}{" "}
                  · 테이블 {countFor(detailTarget, "tableCount", "tables")} ·
                  에셋 {countFor(detailTarget, "assetCount", "assets")}
                </dd>
              </div>
              <div>
                <dt>보존 정책</dt>
                <dd>무기한 · 자동 삭제 없음</dd>
              </div>
            </dl>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button">확인</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
      >
        {restoreTarget && (
          <DialogContent
            className="lifecycle-dialog"
            onCloseAutoFocus={(event) => {
              if (restoreTriggerRef.current?.isConnected) {
                event.preventDefault();
                restoreTriggerRef.current.focus();
              }
            }}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleRestore();
              }}
            >
              <DialogHeader>
                <DialogTitle>복원</DialogTitle>
                <DialogDescription>
                  충돌 시 덮어쓰지 않습니다.
                </DialogDescription>
              </DialogHeader>
              <FieldGroup className="dialog-field-group">
                <Field>
                  <FieldLabel htmlFor="restore-strategy">충돌 처리</FieldLabel>
                  <NativeSelect
                    id="restore-strategy"
                    className="w-full"
                    value={restoreStrategy}
                    onChange={(event) =>
                      setRestoreStrategy(
                        event.target.value as RestoreConflictResolution,
                      )
                    }
                  >
                    <NativeSelectOption value="KEEP_ORIGINAL">
                      원래 이름·Slug
                    </NativeSelectOption>
                    <NativeSelectOption value="RENAME">
                      새 이름으로 복원
                    </NativeSelectOption>
                    <NativeSelectOption value="NEW_SLUG">
                      새 이름·Slug
                    </NativeSelectOption>
                  </NativeSelect>
                </Field>
                {restoreStrategy !== "KEEP_ORIGINAL" && (
                  <Field data-invalid={!restoreName.trim()}>
                    <FieldLabel htmlFor="restore-name">
                      새 프로젝트 이름
                    </FieldLabel>
                    <Input
                      id="restore-name"
                      value={restoreName}
                      aria-invalid={!restoreName.trim()}
                      onChange={(event) => setRestoreName(event.target.value)}
                    />
                  </Field>
                )}
                {restoreStrategy === "NEW_SLUG" && (
                  <Field data-invalid={!restoreSlug.trim()}>
                    <FieldLabel htmlFor="restore-slug">새 Slug</FieldLabel>
                    <Input
                      id="restore-slug"
                      value={restoreSlug}
                      aria-invalid={!restoreSlug.trim()}
                      onChange={(event) => setRestoreSlug(event.target.value)}
                    />
                  </Field>
                )}
                {restoreError && <FieldError>{restoreError}</FieldError>}
              </FieldGroup>
              <DialogFooter>
                <DialogClose asChild>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busyKey !== null}
                  >
                    취소
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={busyKey !== null}>
                  {busyKey === `${restoreTarget.id}:restore` && (
                    <Spinner data-icon="inline-start" />
                  )}
                  복원
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>

      <AlertDialog
        open={purgeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPurgeTarget(null);
            setPurgePlan(null);
          }
        }}
      >
        {purgeTarget && (
          <AlertDialogContent
            className="dialog lifecycle-dialog purge-dialog"
            onCloseAutoFocus={(event) => {
              if (purgeTriggerRef.current?.isConnected) {
                event.preventDefault();
                purgeTriggerRef.current.focus();
              }
            }}
          >
            <AlertDialogMedia className="dialog-icon destructive">
              <ShieldAlert aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogHeader>
              <AlertDialogTitle>영구 삭제</AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogDescription>
              삭제 후 프로젝트를 복원할 수 없습니다.
            </AlertDialogDescription>
            {!purgePlan && !purgePlanError && (
              <div className="purge-plan-loading" role="status">
                <Spinner /> 삭제 계획 계산 중
              </div>
            )}
            {purgePlanError && (
              <Alert variant="destructive">
                <CircleAlert aria-hidden="true" />
                <AlertTitle>계획 생성 실패</AlertTitle>
                <AlertDescription>{purgePlanError}</AlertDescription>
              </Alert>
            )}
            {purgePlan && (
              <>
                <dl className="impact-summary purge-impact-summary">
                  <div>
                    <dt>Metadata</dt>
                    <dd>{purgePlan.metadataRecordCount}</dd>
                  </div>
                  <div>
                    <dt>파일</dt>
                    <dd>{purgePlan.fileCount}</dd>
                  </div>
                  <div>
                    <dt>회수 예상</dt>
                    <dd>{formatBytes(purgePlan.estimatedBytes)}</dd>
                  </div>
                </dl>
                {purgePlan.blockers.length > 0 && (
                  <Alert variant="destructive">
                    <ShieldAlert aria-hidden="true" />
                    <AlertTitle>영구 삭제 차단</AlertTitle>
                    <AlertDescription>
                      {purgePlan.blockers.join(" · ")}
                    </AlertDescription>
                  </Alert>
                )}
                <FieldGroup className="dialog-field-group">
                  <Field
                    data-invalid={
                      typedConfirmation.length > 0 &&
                      typedConfirmation !== purgeTarget.name
                    }
                  >
                    <FieldLabel htmlFor="purge-confirmation">
                      프로젝트 이름 정확히 입력
                    </FieldLabel>
                    <Input
                      id="purge-confirmation"
                      value={typedConfirmation}
                      autoComplete="off"
                      aria-invalid={
                        typedConfirmation.length > 0 &&
                        typedConfirmation !== purgeTarget.name
                      }
                      placeholder={purgeTarget.name}
                      onChange={(event) =>
                        setTypedConfirmation(event.target.value)
                      }
                    />
                  </Field>
                  <FieldSet>
                    <FieldLegend variant="label">최종 백업</FieldLegend>
                    <Field orientation="horizontal">
                      <Checkbox
                        id="backup-before-purge"
                        checked={backupBeforePurge}
                        onCheckedChange={(checked) =>
                          setBackupBeforePurge(checked === true)
                        }
                      />
                      <FieldLabel htmlFor="backup-before-purge">
                        삭제 전 백업
                      </FieldLabel>
                    </Field>
                  </FieldSet>
                  <FieldDescription>
                    계획 만료: {formatDate(purgePlan.expiresAt)}
                  </FieldDescription>
                </FieldGroup>
              </>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel
                variant="outline"
                disabled={busyKey?.endsWith(":purge") === true}
              >
                취소
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={
                  !purgePlan ||
                  purgePlan.blockers.length > 0 ||
                  typedConfirmation !== purgeTarget.name ||
                  busyKey?.endsWith(":purge") === true
                }
                onClick={(event) => {
                  event.preventDefault();
                  void handlePurge();
                }}
              >
                {busyKey === `${purgeTarget.id}:purge` && (
                  <Spinner data-icon="inline-start" />
                )}
                영구 삭제
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}
