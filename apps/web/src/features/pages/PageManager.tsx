import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PAGE_TYPES, type PageType } from "@webeditor/domain";
import {
  AlertTriangle,
  Eye,
  FilePlus2,
  GripVertical,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ProjectDto } from "@/services/projects-api";
import {
  createPage,
  createDraftPreview,
  deletePage,
  listPages,
  planPageDelete,
  planPublish,
  publishProject,
  reorderPages,
  undoPageDelete,
  updatePage,
  updatePageIcon,
  type DeleteImpact,
  type IconCatalogItem,
  type PageDto,
  type PublishPlan,
} from "@/services/pages-api";
import { DynamicLucideIcon } from "./DynamicLucideIcon";
import { IconPicker } from "./IconPicker";

export const PAGE_TYPE_LABELS: Record<PageType, string> = {
  analysis: "분석",
  blank: "빈 페이지",
  board: "보드",
  chat: "채팅",
  dashboard: "대시보드",
  "data-viewer": "데이터 보기",
  "experiment-comparison": "실험 비교",
  form: "폼",
  report: "보고서",
  "search-result": "검색 결과",
  settings: "설정",
  "spc-dashboard": "SPC 대시보드",
};

interface PageManagerProps {
  project: ProjectDto;
  selectedPageId: string | null;
  onSelectPage: (page: PageDto | null) => void;
  onPagesChange?: (pages: PageDto[]) => void;
  onProjectRevisionChange?: (revision: number) => void;
  onOpenDraftPreview?: (url: string) => void;
}

interface SortablePageRowProps {
  page: PageDto;
  active: boolean;
  busy: boolean;
  editing: boolean;
  draftName: string;
  onDraftNameChange: (name: string) => void;
  onSelect: () => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onSelectIcon: (icon: IconCatalogItem) => Promise<void>;
  onDelete: () => void;
}

function SortablePageRow(props: SortablePageRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.page.id, disabled: props.busy });
  const style = { transform: CSS.Transform.toString(transform), transition };

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      props.onCommitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      props.onCancelRename();
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "page-manager-row",
        props.active && "is-active",
        isDragging && "is-dragging",
      )}
      aria-current={props.active ? "page" : undefined}
      data-page-id={props.page.id}
    >
      <Button
        className="page-drag-handle"
        variant="ghost"
        size="icon-sm"
        type="button"
        aria-label={`${props.page.name} 순서 이동`}
        {...attributes}
        {...listeners}
      >
        <GripVertical />
      </Button>
      <IconPicker
        currentIcon={props.page.iconName}
        disabled={props.busy}
        onSelect={props.onSelectIcon}
      />
      {props.editing ? (
        <Input
          className="page-rename-input"
          value={props.draftName}
          aria-label="페이지 이름"
          aria-invalid={
            props.draftName.trim().length === 0 || props.draftName.length >= 100
          }
          maxLength={100}
          autoFocus
          onChange={(event) => props.onDraftNameChange(event.target.value)}
          onKeyDown={handleRenameKeyDown}
          onBlur={props.onCommitRename}
        />
      ) : (
        <button
          className="page-row-name"
          type="button"
          onClick={props.onSelect}
          onDoubleClick={props.onStartRename}
        >
          <strong>{props.page.name}</strong>
          <small>{props.page.route}</small>
        </button>
      )}
      <Badge variant="secondary">{PAGE_TYPE_LABELS[props.page.pageType]}</Badge>
      <Button
        className="page-trash-button"
        variant="destructive"
        size="icon-sm"
        type="button"
        aria-label={`${props.page.name} 삭제`}
        disabled={props.busy}
        onClick={props.onDelete}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function DragPageOverlay({ page }: { page: PageDto }) {
  return (
    <div className="page-drag-overlay" aria-label={`${page.name} 이동 중`}>
      <GripVertical aria-hidden="true" />
      <DynamicLucideIcon iconName={page.iconName} />
      <strong>{page.name}</strong>
    </div>
  );
}

export function PageManager({
  project,
  selectedPageId,
  onSelectPage,
  onPagesChange,
  onProjectRevisionChange,
  onOpenDraftPreview,
}: PageManagerProps) {
  const [pages, setPages] = useState<PageDto[]>([]);
  const projectRevision = project.revision;
  const [publishedVersionId, setPublishedVersionId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PageDto | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<DeleteImpact | null>(null);
  const [deletePlanLoading, setDeletePlanLoading] = useState(false);
  const [deletePlanError, setDeletePlanError] = useState("");
  const [deletePlanRevision, setDeletePlanRevision] = useState<number | null>(
    null,
  );
  const [undoCommand, setUndoCommand] = useState<{
    commandId: string;
    page: PageDto;
  } | null>(null);
  const [publishPlan, setPublishPlan] = useState<PublishPlan | null>(null);
  const renameCancelled = useRef(false);
  const renameSubmitting = useRef(false);
  const selectedPageIdRef = useRef(selectedPageId);
  const onProjectRevisionChangeRef = useRef(onProjectRevisionChange);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    selectedPageIdRef.current = selectedPageId;
  }, [selectedPageId]);

  useEffect(() => {
    onProjectRevisionChangeRef.current = onProjectRevisionChange;
  }, [onProjectRevisionChange]);

  const updateProjectRevision = useCallback((revision: number) => {
    onProjectRevisionChangeRef.current?.(revision);
  }, []);

  const syncPages = useCallback(
    (nextPages: PageDto[]) => {
      const sorted = [...nextPages].sort((a, b) => a.sortOrder - b.sortOrder);
      setPages(sorted);
      onPagesChange?.(sorted);
      const selected =
        sorted.find((page) => page.id === selectedPageIdRef.current) ??
        sorted[0] ??
        null;
      onSelectPage(selected);
    },
    [onPagesChange, onSelectPage],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await listPages(project.id);
      updateProjectRevision(payload.projectRevision);
      setPublishedVersionId(payload.publishedVersionId);
      syncPages(payload.pages);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "페이지 오류");
    } finally {
      setLoading(false);
    }
  }, [project.id, syncPages, updateProjectRevision]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "저장 실패");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function createPageOfType(pageType: PageType) {
    await mutate(async () => {
      const payload = await createPage(project.id, projectRevision, pageType);
      updateProjectRevision(payload.projectRevision);
      const next = [...pages, payload.page];
      syncPages(next);
      onSelectPage(payload.page);
    });
  }

  function startRename(page: PageDto) {
    renameCancelled.current = false;
    renameSubmitting.current = false;
    setEditingId(page.id);
    setDraftName(page.name);
  }

  function cancelRename() {
    renameCancelled.current = true;
    setEditingId(null);
    setDraftName("");
  }

  async function commitRename(page: PageDto) {
    if (renameCancelled.current || renameSubmitting.current) return;
    const name = draftName.trim();
    if (!name || name.length >= 100) return;
    if (name === page.name) {
      setEditingId(null);
      return;
    }
    renameSubmitting.current = true;
    setEditingId(null);
    await mutate(async () => {
      const payload = await updatePage(page, projectRevision, { name });
      updateProjectRevision(payload.projectRevision);
      syncPages(
        pages.map((candidate) =>
          candidate.id === page.id ? payload.page : candidate,
        ),
      );
    });
    renameSubmitting.current = false;
  }

  async function chooseIcon(page: PageDto, icon: IconCatalogItem) {
    await mutate(async () => {
      const payload = await updatePageIcon(page, projectRevision, icon.name);
      updateProjectRevision(payload.projectRevision);
      syncPages(
        pages.map((candidate) =>
          candidate.id === page.id ? payload.page : candidate,
        ),
      );
    });
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(String(event.active.id));
  }

  function handleDragCancel() {
    setActiveDragId(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    if (!event.over || event.active.id === event.over.id) return;
    const from = pages.findIndex((page) => page.id === event.active.id);
    const to = pages.findIndex((page) => page.id === event.over?.id);
    if (from < 0 || to < 0) return;
    const reordered = arrayMove(pages, from, to).map((page, index) => ({
      ...page,
      sortOrder: index,
    }));
    syncPages(reordered);
    void mutate(async () => {
      const payload = await reorderPages(
        project.id,
        reordered.map((page) => page.id),
        projectRevision,
      );
      updateProjectRevision(payload.projectRevision);
      syncPages(payload.pages);
    });
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    await mutate(async () => {
      const payload = await deletePage(target, projectRevision);
      updateProjectRevision(payload.projectRevision);
      setUndoCommand({ commandId: payload.commandId, page: target });
      syncPages(pages.filter((page) => page.id !== target.id));
    });
  }

  async function openDeletePlan(page: PageDto) {
    setDeleteTarget(page);
    setDeleteImpact(null);
    setDeletePlanError("");
    setDeletePlanRevision(null);
    setDeletePlanLoading(true);
    try {
      const payload = await planPageDelete(page, projectRevision);
      setDeleteImpact(payload.impact);
      setDeletePlanRevision(projectRevision);
    } catch (reason) {
      setDeletePlanError(
        reason instanceof Error ? reason.message : "영향 확인 실패",
      );
    } finally {
      setDeletePlanLoading(false);
    }
  }

  async function undoDelete() {
    const command = undoCommand;
    if (!command) return;
    await mutate(async () => {
      const payload = await undoPageDelete(
        project.id,
        command.commandId,
        projectRevision,
      );
      updateProjectRevision(payload.projectRevision);
      setUndoCommand(null);
      syncPages([...pages, payload.page]);
      onSelectPage(payload.page);
    });
  }

  async function preparePublish() {
    await mutate(async () => {
      const payload = await planPublish(project.id, projectRevision);
      setPublishPlan(payload.plan);
    });
  }

  async function openDraftPreview() {
    await mutate(async () => {
      const payload = await createDraftPreview(project.id, projectRevision);
      const url = `/preview/${encodeURIComponent(project.id)}/${encodeURIComponent(payload.previewId)}/`;
      if (onOpenDraftPreview) onOpenDraftPreview(url);
      else window.location.assign(url);
    });
  }

  async function confirmPublish() {
    if (!publishPlan || publishPlan.errors.length > 0) return;
    await mutate(async () => {
      const payload = await publishProject(project.id, projectRevision);
      updateProjectRevision(payload.projectRevision);
      setPublishedVersionId(payload.versionId);
      setPublishPlan(null);
    });
  }

  const activeDragPage = pages.find((page) => page.id === activeDragId) ?? null;

  return (
    <section className="page-manager" aria-label="페이지 관리자">
      <div className="panel-heading page-manager-heading">
        <strong>페이지</strong>
        <div className="page-manager-actions">
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={busy || loading}
            onClick={() => void openDraftPreview()}
          >
            <Eye data-icon="inline-start" />
            미리보기
          </Button>
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={busy || loading}
            onClick={() => void preparePublish()}
          >
            <Send data-icon="inline-start" />
            게시
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                type="button"
                disabled={busy || loading}
                aria-label="페이지 추가"
              >
                <FilePlus2 data-icon="inline-start" />
                페이지
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="page-type-menu"
              align="end"
              aria-label="페이지 유형"
            >
              {PAGE_TYPES.map((pageType) => (
                <DropdownMenuItem
                  key={pageType}
                  onSelect={() => void createPageOfType(pageType)}
                >
                  {PAGE_TYPE_LABELS[pageType]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {error && (
        <div className="page-manager-error" role="alert">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            재시도
          </Button>
        </div>
      )}

      {loading ? (
        <div
          className="page-manager-loading"
          role="status"
          aria-label="페이지 로딩"
        >
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : pages.length === 0 ? (
        <Empty className="page-manager-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FilePlus2 />
            </EmptyMedia>
            <EmptyTitle>페이지 없음</EmptyTitle>
            <EmptyDescription>빈 페이지를 추가하세요.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              type="button"
              onClick={() => void createPageOfType("blank")}
            >
              <FilePlus2 data-icon="inline-start" />빈 페이지
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={pages.map((page) => page.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="page-manager-list">
              {pages.map((page) => (
                <SortablePageRow
                  key={page.id}
                  page={page}
                  active={selectedPageId === page.id}
                  busy={busy}
                  editing={editingId === page.id}
                  draftName={draftName}
                  onDraftNameChange={setDraftName}
                  onSelect={() => onSelectPage(page)}
                  onStartRename={() => startRename(page)}
                  onCommitRename={() => void commitRename(page)}
                  onCancelRename={cancelRename}
                  onSelectIcon={(icon) => chooseIcon(page, icon)}
                  onDelete={() => void openDeletePlan(page)}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay dropAnimation={{ duration: 140, easing: "ease-out" }}>
            {activeDragPage ? <DragPageOverlay page={activeDragPage} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      <div className="page-manager-footer">
        <span>{publishedVersionId ? "게시됨" : "미게시"}</span>
        {undoCommand && (
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => void undoDelete()}
            disabled={busy}
          >
            <RotateCcw data-icon="inline-start" />
            삭제 취소
          </Button>
        )}
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteImpact(null);
            setDeletePlanError("");
            setDeletePlanRevision(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <AlertTriangle />
            </AlertDialogMedia>
            <AlertDialogTitle>페이지 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              초안 삭제 · 게시본 유지
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deletePlanLoading && <div role="status">영향 확인 중</div>}
          {deletePlanError && (
            <div className="page-manager-error" role="alert">
              <span>{deletePlanError}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (deleteTarget) void openDeletePlan(deleteTarget);
                }}
              >
                재시도
              </Button>
            </div>
          )}
          {deleteImpact && (
            <dl className="page-delete-impact">
              <div>
                <dt>요소</dt>
                <dd>{deleteImpact.elementCount}</dd>
              </div>
              <div>
                <dt>바인딩</dt>
                <dd>{deleteImpact.bindingCount}</dd>
              </div>
              <div>
                <dt>탐색</dt>
                <dd>{deleteImpact.navigationReferenceCount}</dd>
              </div>
              <div>
                <dt>검증</dt>
                <dd>{deleteImpact.validationScenarioCount}</dd>
              </div>
            </dl>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={
                !deleteImpact ||
                deletePlanLoading ||
                deletePlanRevision !== projectRevision
              }
              onClick={() => void confirmDelete()}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={publishPlan !== null}
        onOpenChange={(open) => {
          if (!open) setPublishPlan(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>게시</AlertDialogTitle>
            <AlertDialogDescription>
              페이지 {publishPlan?.pages.length ?? 0}개
            </AlertDialogDescription>
          </AlertDialogHeader>
          {publishPlan && publishPlan.errors.length > 0 && (
            <ul className="publish-errors" role="alert">
              {publishPlan.errors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {publishPlan && publishPlan.warnings.length > 0 && (
            <ul className="publish-warnings">
              {publishPlan.warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(publishPlan?.errors.length)}
              onClick={() => void confirmPublish()}
            >
              게시
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
