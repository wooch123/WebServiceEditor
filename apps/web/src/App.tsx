import {
  ArrowLeft,
  Blocks,
  Check,
  ChevronRight,
  Clock3,
  Database,
  LayoutDashboard,
  Minus,
  Plus,
  Save,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { Button } from "@/components/ui/button";
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
  WorkspaceElementPalette,
} from "@/features/elements/ElementWorkspace";
import { PageManager } from "@/features/pages/PageManager";
import { PublishedRuntime } from "@/features/runtime/PublishedRuntime";
import type { PageDto } from "@/services/pages-api";
import { updateProject } from "@/services/projects-api";
import type { ProjectDto } from "@/services/projects-api";
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

type EditorStep = "page" | "data" | "validation";

interface HeaderControlsProps {
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  themeId: string;
  onThemeChange: (themeId: string) => void;
}

function HeaderControls({
  fontSize,
  onFontSizeChange,
  themeId,
  onThemeChange,
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
      <ThemePicker themeId={themeId} onThemeChange={onThemeChange} />
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

function ValidationPreview({ pageExists }: { pageExists: boolean }) {
  const checks = [
    ["페이지 구조", pageExists ? "1/1 통과" : "페이지 필요"],
    ["데이터 연결", "2개 확인 필요"],
    ["샘플 입출력", "실행 대기"],
  ];

  return (
    <div className="validation-stage">
      <div className="validation-hero">
        <span className="validation-icon">
          <ShieldCheck aria-hidden="true" />
        </span>
        <div>
          <h2>검증</h2>
        </div>
      </div>
      <div className="validation-list">
        {checks.map(([label, result], index) => (
          <div key={label}>
            <span
              className={
                index === 0 && pageExists ? "check-complete" : "check-pending"
              }
            >
              {index === 0 && pageExists ? (
                <Check aria-hidden="true" />
              ) : (
                <Clock3 aria-hidden="true" />
              )}
            </span>
            <strong>{label}</strong>
            <span>{result}</span>
          </div>
        ))}
      </div>
    </div>
  );
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
      onProjectRevisionChange={onProjectRevisionChange}
      onLayoutRevisionChange={(pageId, revision) =>
        setLayoutRevisions((current) => ({
          ...current,
          [pageId]: Math.max(current[pageId] ?? 0, revision),
        }))
      }
    >
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

        <div className="editor-workspace">
          <aside className="editor-left-panel">
            <PageManager
              project={project}
              selectedPageId={selectedPage?.id ?? null}
              onSelectPage={setSelectedPage}
              onProjectRevisionChange={onProjectRevisionChange}
            />
            <WorkspaceElementPalette disabled={step !== "page"} />
          </aside>

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
            {step === "data" && (
              <DatabaseDesigner
                projectId={project.id}
                projectRevision={project.revision}
                onProjectRevisionChange={onProjectRevisionChange}
              />
            )}
            {step === "validation" && (
              <ValidationPreview pageExists={selectedPage !== null} />
            )}
          </main>

          <aside className="inspector-panel">
            <div className="panel-heading">
              <div>
                <strong>
                  {step === "page"
                    ? "속성"
                    : step === "data"
                      ? "연결 정보"
                      : "검증 요약"}
                </strong>
              </div>
            </div>
            {step === "page" && <ElementPropertyInspector />}
            {step === "data" && (
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
                  {selectedPage ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <Clock3 aria-hidden="true" />
                  )}
                  통과 {selectedPage ? 1 : 0}
                </span>
                <span>
                  <Clock3 aria-hidden="true" />
                  확인 필요 {selectedPage ? 2 : 3}
                </span>
                <span>
                  <ShieldCheck aria-hidden="true" />
                  샘플 검증 전 게시 차단
                </span>
              </div>
            )}
          </aside>
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
  const [themeId, setThemeId] = useState(defaultTheme.id);
  const themeRequestSequenceRef = useRef(0);

  const selectedTheme =
    themes.find((theme) => theme.id === themeId) ?? defaultTheme;
  const controls: HeaderControlsProps = {
    fontSize,
    onFontSizeChange: setFontSize,
    themeId,
    onThemeChange: (nextThemeId) => {
      const previousThemeId = selectedProject?.themeId ?? themeId;
      setThemeId(nextThemeId);
      if (surface === "editor" && selectedProject) {
        const requestSequence = ++themeRequestSequenceRef.current;
        const projectAtRequest = selectedProject;
        setSelectedProject({ ...projectAtRequest, themeId: nextThemeId });
        void updateProject(projectAtRequest.id, {
          expectedRevision: projectAtRequest.revision,
          themeId: nextThemeId,
        })
          .then((updatedProject) => {
            setSelectedProject((current) => {
              if (
                current?.id !== updatedProject.id ||
                updatedProject.revision < current.revision
              ) {
                return current;
              }
              return {
                ...updatedProject,
                themeId:
                  requestSequence === themeRequestSequenceRef.current
                    ? updatedProject.themeId
                    : current.themeId,
              };
            });
          })
          .catch(() => {
            if (requestSequence !== themeRequestSequenceRef.current) return;
            setThemeId(previousThemeId);
            setSelectedProject((current) =>
              current?.id === projectAtRequest.id
                ? { ...current, themeId: previousThemeId }
                : current,
            );
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
          onBack={() => setSurface("home")}
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
            themeId={themeId}
            onOpenProject={(project) => {
              setSelectedProject(project);
              setThemeId(project.themeId);
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

  return <ProductApp />;
}
