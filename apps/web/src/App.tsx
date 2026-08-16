import {
  ArrowLeft,
  Blocks,
  ChevronRight,
  Database,
  LayoutDashboard,
  Minus,
  Plus,
  Save,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ValidationTargetDto } from "@webeditor/domain";
import type { CSSProperties } from "react";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DatabaseDesigner } from "@/features/data-schema/DatabaseDesigner";
import {
  CanvasControls,
  ElementCanvas,
} from "@/features/elements/ElementCanvas";
import {
  ElementHistoryControls,
  ElementPropertyInspector,
} from "@/features/elements/ElementPropertyInspector";
import {
  ElementWorkspaceProvider,
  useElementWorkspace,
  WorkspaceElementPalette,
} from "@/features/elements/ElementWorkspace";
import { PageManager } from "@/features/pages/PageManager";
import { ValidationReport } from "@/features/validation/ValidationReport";
import {
  DraftPreviewRuntime,
  PublishedRuntime,
} from "@/features/runtime/PublishedRuntime";
import { cn } from "@/lib/utils";
import { listPages, type PageDto } from "@/services/pages-api";
import type { ProjectDto } from "@/services/projects-api";
import {
  createThemeRevision,
  validateThemeRevision,
} from "@/services/themes-api";
import { ThemePicker } from "./ThemePicker";
import { defaultTheme, themes, themeToCssVariables } from "./theme";

const DesignSystemGallery = lazy(async () => {
  const gallery = await import("./DesignSystemGallery");
  return { default: gallery.DesignSystemGallery };
});

const ProjectHome = lazy(async () => {
  const projects = await import("@/features/projects/ProjectHome");
  return { default: projects.ProjectHome };
});

const RelationshipCanvas = lazy(async () => {
  const relationship =
    await import("@/features/data-relationship/RelationshipCanvas");
  return { default: relationship.RelationshipCanvas };
});

const HOME_THEME_STORAGE_KEY = "webeditor:home-theme-id";

function readHomeThemeId(): string {
  if (typeof window === "undefined") return defaultTheme.id;
  try {
    const stored = window.localStorage.getItem(HOME_THEME_STORAGE_KEY);
    return themes.some(({ id }) => id === stored)
      ? (stored as string)
      : defaultTheme.id;
  } catch {
    return defaultTheme.id;
  }
}

function writeHomeThemeId(themeId: string): void {
  try {
    window.localStorage.setItem(HOME_THEME_STORAGE_KEY, themeId);
  } catch {
    // The selected theme remains active for this session when storage is unavailable.
  }
}

type EditorStep = "page" | "data" | "validation";

interface HeaderControlsProps {
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  themeId: string;
  onThemeChange: (themeId: string) => void;
  themePending: boolean;
  themeStatus: string;
}

function HeaderControls({
  fontSize,
  onFontSizeChange,
  themeId,
  onThemeChange,
  themePending,
  themeStatus,
}: HeaderControlsProps) {
  return (
    <div className="header-controls" aria-label="화면 표시 설정">
      <div className="font-size-control" aria-label="글꼴 크기">
        <Button
          className="icon-button"
          variant="ghost"
          size="icon-sm"
          type="button"
          aria-label="글꼴 크기 줄이기"
          disabled={fontSize === 10}
          onClick={() => onFontSizeChange(Math.max(10, fontSize - 1))}
        >
          <Minus aria-hidden="true" />
        </Button>
        <output aria-live="polite" aria-label="현재 글꼴 크기">
          {fontSize}px
        </output>
        <Button
          className="icon-button"
          variant="ghost"
          size="icon-sm"
          type="button"
          aria-label="글꼴 크기 늘리기"
          disabled={fontSize === 24}
          onClick={() => onFontSizeChange(Math.min(24, fontSize + 1))}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
      {themeStatus && (
        <span className="theme-sync-status" role="status">
          {themeStatus}
        </span>
      )}
      <ThemePicker
        themeId={themeId}
        onThemeChange={onThemeChange}
        disabled={themePending}
      />
    </div>
  );
}

function Brand() {
  return (
    <div className="brand" aria-label="WebEditor">
      <span className="brand-mark">
        <Blocks aria-hidden="true" />
      </span>
      <span className="brand-wordmark">WebEditor</span>
    </div>
  );
}

function ValidationTargetNavigator({
  target,
  pageId,
  onDone,
}: {
  target: ValidationTargetDto | null;
  pageId: string | null;
  onDone: () => void;
}) {
  const workspace = useElementWorkspace();
  useEffect(() => {
    if (!target || target.pageId !== pageId) return;
    if (target.elementId) workspace.selectElement(target.elementId, false);
    if (target.propertyTabId) {
      requestAnimationFrame(() => {
        const tabs = [...document.querySelectorAll<HTMLElement>("[role=tab]")];
        tabs
          .find(
            (tab) =>
              tab.textContent?.trim().toLocaleLowerCase() ===
              target.propertyTabId?.toLocaleLowerCase(),
          )
          ?.click();
      });
    }
    onDone();
  }, [onDone, pageId, target, workspace]);
  return null;
}

function EditorSurface({
  project,
  onBack,
  onProjectRevisionChange,
  controls,
}: {
  project: ProjectDto;
  onBack: () => void;
  onProjectRevisionChange: (revision: number) => void;
  controls: HeaderControlsProps;
}) {
  const [step, setStep] = useState<EditorStep>("page");
  const [selectedPage, setSelectedPage] = useState<PageDto | null>(null);
  const [layoutRevisions, setLayoutRevisions] = useState<
    Record<string, number>
  >({});
  const [saved, setSaved] = useState(true);
  const [dataView, setDataView] = useState<"schema" | "relationship">("schema");
  const [validationTarget, setValidationTarget] =
    useState<ValidationTargetDto | null>(null);

  const navigateFromValidation = (target: ValidationTargetDto) => {
    if (target.kind === "TABLE" || target.kind === "FIELD") {
      setDataView("schema");
      setStep("data");
      return;
    }
    if (target.kind === "BINDING") {
      setDataView("relationship");
      setStep("data");
      return;
    }
    if (target.kind === "RUNTIME_ROUTE" && target.route) {
      window.open(target.route, "_blank", "noopener,noreferrer");
      return;
    }
    if (target.kind === "THEME") {
      document.querySelector<HTMLElement>("[aria-label='테마 선택']")?.focus();
      return;
    }
    setStep("page");
    setValidationTarget(target);
    if (target.pageId && target.pageId !== selectedPage?.id) {
      void listPages(project.id).then(({ pages }) => {
        const page = pages.find((candidate) => candidate.id === target.pageId);
        if (page) setSelectedPage(page);
      });
    }
  };

  const steps: Array<{
    id: EditorStep;
    number: string;
    label: string;
    icon: LucideIcon;
  }> = [
    { id: "page", number: "01", label: "페이지", icon: LayoutDashboard },
    { id: "data", number: "02", label: "데이터", icon: Database },
    {
      id: "validation",
      number: "03",
      label: "검증",
      icon: ShieldCheck,
    },
  ];

  return (
    <ElementWorkspaceProvider
      projectId={project.id}
      pageId={selectedPage?.id ?? null}
      projectRevision={project.revision}
      layoutRevision={
        selectedPage ? (layoutRevisions[selectedPage.id] ?? 0) : 0
      }
      bindingExecutionActive={step === "page"}
      onProjectRevisionChange={onProjectRevisionChange}
      onLayoutRevisionChange={(pageId, revision) =>
        setLayoutRevisions((current) => ({
          ...current,
          [pageId]: Math.max(current[pageId] ?? 0, revision),
        }))
      }
    >
      <ValidationTargetNavigator
        target={validationTarget}
        pageId={selectedPage?.id ?? null}
        onDone={() => setValidationTarget(null)}
      />
      <div className="surface editor-surface">
        <header className="app-header editor-header">
          <button
            className="icon-button back-button"
            type="button"
            aria-label="프로젝트 홈으로"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" />
          </button>
          <Brand />
          <div className="editor-project-name">
            <span>프로젝트</span>
            <strong>{project.name}</strong>
          </div>
          <button
            className={`button save-button ${saved ? "secondary" : "primary"}`}
            type="button"
            onClick={() => setSaved(true)}
          >
            <Save aria-hidden="true" />
            {saved ? "저장됨" : "저장"}
          </button>
          <ElementHistoryControls />
          <HeaderControls {...controls} />
        </header>

        <nav className="step-navigation" aria-label="제작 단계">
          {steps.map((item, index) => {
            const Icon = item.icon;
            return (
              <div className="step-segment" key={item.id}>
                <button
                  type="button"
                  className={step === item.id ? "is-active" : ""}
                  aria-current={step === item.id ? "step" : undefined}
                  onClick={() => setStep(item.id)}
                >
                  <span>{item.number}</span>
                  <Icon aria-hidden="true" />
                  <strong>{item.label}</strong>
                </button>
                {index < steps.length - 1 && (
                  <ChevronRight aria-hidden="true" />
                )}
              </div>
            );
          })}
        </nav>

        <div
          className={cn(
            "editor-workspace",
            step === "data" &&
              dataView === "relationship" &&
              "is-relationship-canvas",
          )}
        >
          {!(step === "data" && dataView === "relationship") && (
            <aside className="editor-left-panel" data-layout="pages-elements">
              <PageManager
                project={project}
                selectedPageId={selectedPage?.id ?? null}
                onSelectPage={setSelectedPage}
                onProjectRevisionChange={onProjectRevisionChange}
              />
              <WorkspaceElementPalette disabled={step !== "page"} />
            </aside>
          )}

          <main className="editor-main">
            <div className="canvas-toolbar">
              <div className="canvas-toolbar-heading">
                <span className="canvas-breadcrumb">
                  {selectedPage?.name ?? "페이지 없음"}
                </span>
                <strong>{steps.find((item) => item.id === step)?.label}</strong>
              </div>
              {step === "page" ? (
                <CanvasControls />
              ) : step === "data" ? (
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={dataView}
                  onValueChange={(value) => {
                    if (value === "schema" || value === "relationship") {
                      setDataView(value);
                    }
                  }}
                  className="data-view-toggle"
                  aria-label="데이터 화면"
                >
                  <ToggleGroupItem value="schema">스키마</ToggleGroupItem>
                  <ToggleGroupItem value="relationship">관계</ToggleGroupItem>
                </ToggleGroup>
              ) : (
                <span className="zoom-indicator">100%</span>
              )}
            </div>
            {step === "page" &&
              (selectedPage ? (
                <ElementCanvas />
              ) : (
                <div className="editor-empty-state" role="status">
                  <strong>페이지 없음</strong>
                  <span>빈 페이지 추가</span>
                </div>
              ))}
            {step === "data" && dataView === "schema" && (
              <DatabaseDesigner
                projectId={project.id}
                projectRevision={project.revision}
                onProjectRevisionChange={onProjectRevisionChange}
              />
            )}
            {step === "data" && dataView === "relationship" && (
              <Suspense fallback={<div role="status">관계 불러오는 중</div>}>
                <RelationshipCanvas
                  projectId={project.id}
                  projectRevision={project.revision}
                  onProjectRevisionChange={onProjectRevisionChange}
                />
              </Suspense>
            )}
            {step === "validation" && (
              <ValidationReport
                projectId={project.id}
                projectRevision={project.revision}
                onNavigate={navigateFromValidation}
              />
            )}
          </main>

          {!(step === "data" && dataView === "relationship") && (
            <aside className="inspector-panel">
              <div className="panel-heading">
                <div>
                  <strong>
                    {step === "page"
                      ? "속성"
                      : step === "data"
                        ? dataView === "schema"
                          ? "스키마"
                          : "Binding"
                        : "검증 요약"}
                  </strong>
                </div>
              </div>
              {step === "page" && <ElementPropertyInspector />}
              {step === "data" && dataView === "schema" && (
                <div className="inspector-summary">
                  <span>
                    <Database aria-hidden="true" />
                    Test DB
                  </span>
                  <span>
                    <Waypoints aria-hidden="true" />
                    관계
                  </span>
                </div>
              )}
              {step === "validation" && (
                <div className="inspector-summary">
                  <span>
                    <ShieldCheck aria-hidden="true" />
                    정적
                  </span>
                  <span>
                    <Database aria-hidden="true" />
                    DB
                  </span>
                  <span>
                    <Waypoints aria-hidden="true" />
                    Binding
                  </span>
                </div>
              )}
            </aside>
          )}
        </div>

        <footer className="editor-statusbar">
          <span>
            <span className="connection-dot" />
            API 연결
          </span>
          <span aria-live="polite">{saved ? "저장됨" : "저장 필요"}</span>
          <span>Draft r{project.revision}</span>
        </footer>
      </div>
    </ElementWorkspaceProvider>
  );
}

function ProductApp() {
  const [surface, setSurface] = useState<"home" | "editor">("home");
  const [selectedProject, setSelectedProject] = useState<ProjectDto | null>(
    null,
  );
  const [fontSize, setFontSize] = useState(12);
  const [homeThemeId, setHomeThemeId] = useState(readHomeThemeId);
  const [themeId, setThemeId] = useState(homeThemeId);
  const [themePending, setThemePending] = useState(false);
  const [themeStatus, setThemeStatus] = useState("");
  const themeRequestSequenceRef = useRef(0);

  const selectedTheme =
    themes.find((theme) => theme.id === themeId) ?? defaultTheme;
  const controls: HeaderControlsProps = {
    fontSize,
    onFontSizeChange: setFontSize,
    themeId,
    themePending,
    themeStatus,
    onThemeChange: (nextThemeId) => {
      if (surface === "home") {
        setHomeThemeId(nextThemeId);
        setThemeId(nextThemeId);
        writeHomeThemeId(nextThemeId);
        return;
      }
      const previousThemeId = selectedProject?.themeId ?? themeId;
      setThemeId(nextThemeId);
      if (surface === "editor" && selectedProject) {
        const requestSequence = ++themeRequestSequenceRef.current;
        const projectAtRequest = selectedProject;
        setThemePending(true);
        setThemeStatus("저장 중");
        setSelectedProject({ ...projectAtRequest, themeId: nextThemeId });
        void createThemeRevision(
          projectAtRequest.id,
          nextThemeId,
          projectAtRequest.revision,
        )
          .then((created) => {
            if (requestSequence === themeRequestSequenceRef.current) {
              setThemeStatus("검증 중");
              setSelectedProject((current) =>
                current?.id === projectAtRequest.id
                  ? {
                      ...current,
                      themeId: nextThemeId,
                      revision: Math.max(
                        current.revision,
                        created.projectRevision,
                      ),
                    }
                  : current,
              );
            }
            return validateThemeRevision(
              projectAtRequest.id,
              created.revision,
              created.projectRevision,
            );
          })
          .then((validated) => {
            if (requestSequence !== themeRequestSequenceRef.current) return;
            setSelectedProject((current) => {
              if (
                current?.id !== projectAtRequest.id ||
                validated.projectRevision < current.revision
              ) {
                return current;
              }
              return {
                ...current,
                revision: validated.projectRevision,
                themeId: validated.revision.presetId,
              };
            });
            setThemeStatus(
              validated.revision.status === "INVALID"
                ? "검증 실패"
                : validated.runtimeApplied
                  ? "적용됨"
                  : "검증됨",
            );
          })
          .catch(() => {
            if (requestSequence !== themeRequestSequenceRef.current) return;
            setThemeId(previousThemeId);
            setThemeStatus("저장 실패");
            setSelectedProject((current) =>
              current?.id === projectAtRequest.id
                ? { ...current, themeId: previousThemeId }
                : current,
            );
          })
          .finally(() => {
            if (requestSequence === themeRequestSequenceRef.current) {
              setThemePending(false);
            }
          });
      }
    },
  };
  const appStyle = {
    ...themeToCssVariables(selectedTheme),
    "--app-base-font-size": `${fontSize}px`,
  } as CSSProperties;

  useLayoutEffect(() => {
    const root = document.documentElement;
    const variables = themeToCssVariables(selectedTheme);
    const previousValues = new Map(
      Object.keys(variables).map((name) => [
        name,
        root.style.getPropertyValue(name),
      ]),
    );
    const previousThemeId = root.dataset.webeditorThemeId;

    for (const [name, value] of Object.entries(variables)) {
      root.style.setProperty(name, value);
    }
    root.dataset.webeditorThemeId = selectedTheme.id;

    return () => {
      for (const [name, value] of previousValues) {
        if (value) root.style.setProperty(name, value);
        else root.style.removeProperty(name);
      }
      if (previousThemeId) root.dataset.webeditorThemeId = previousThemeId;
      else delete root.dataset.webeditorThemeId;
    };
  }, [selectedTheme]);

  return (
    <div
      className="webeditor-app"
      data-theme-id={selectedTheme.id}
      style={appStyle}
    >
      {surface === "editor" && selectedProject ? (
        <EditorSurface
          project={selectedProject}
          onBack={() => {
            setThemeStatus("");
            setThemeId(homeThemeId);
            setSurface("home");
          }}
          onProjectRevisionChange={(revision) =>
            setSelectedProject((current) =>
              current
                ? { ...current, revision: Math.max(current.revision, revision) }
                : current,
            )
          }
          controls={controls}
        />
      ) : (
        <Suspense
          fallback={
            <div className="grid min-h-screen place-items-center" role="status">
              프로젝트 불러오는 중
            </div>
          }
        >
          <ProjectHome
            headerBrand={<Brand />}
            headerControls={<HeaderControls {...controls} />}
            themeId={homeThemeId}
            onOpenProject={(project) => {
              setSelectedProject(project);
              setThemeId(project.themeId);
              setThemeStatus("");
              setSurface("editor");
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

export function App() {
  const pathname =
    typeof window === "undefined" ? "/" : window.location.pathname;

  if (pathname.replace(/\/+$/, "") === "/internal/design-system") {
    return (
      <Suspense
        fallback={
          <div className="grid min-h-screen place-items-center" role="status">
            불러오는 중
          </div>
        }
      >
        <DesignSystemGallery />
      </Suspense>
    );
  }

  if (pathname.startsWith("/runtime/")) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/runtime/:projectId/*" element={<PublishedRuntime />} />
        </Routes>
      </BrowserRouter>
    );
  }

  if (pathname.startsWith("/preview/")) {
    return (
      <BrowserRouter>
        <Routes>
          <Route
            path="/preview/:projectId/:previewId/*"
            element={<DraftPreviewRuntime />}
          />
        </Routes>
      </BrowserRouter>
    );
  }

  return <ProductApp />;
}
