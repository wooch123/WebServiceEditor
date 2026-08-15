import {
  Activity,
  ArrowLeft,
  BarChart3,
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
  Table2,
  Waypoints,
  Wifi,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { lazy, Suspense, useLayoutEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { Button } from "@/components/ui/button";
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

function CanvasPreview({ title }: { title: string }) {
  return (
    <div className="canvas-stage" aria-label="페이지 캔버스">
      <div className="canvas-page">
        <div className="canvas-heading">
          <div>
            <span>REGIONAL HEALTH / 2026</span>
            <h2>{title}</h2>
          </div>
          <span className="status-badge success">
            <Wifi aria-hidden="true" />
            연결됨
          </span>
        </div>
        <div className="metric-grid">
          <article className="metric-card is-selected">
            <span>평균 재원일수</span>
            <strong>8.4일</strong>
            <small>전월 -4.2%</small>
            <i className="resize-dot top-left" />
            <i className="resize-dot top-right" />
            <i className="resize-dot bottom-left" />
            <i className="resize-dot bottom-right" />
          </article>
          <article className="metric-card">
            <span>고위험군 비율</span>
            <strong>12.8%</strong>
            <small>목표 내</small>
          </article>
          <article className="metric-card">
            <span>데이터 완성도</span>
            <strong>98.6%</strong>
            <small>일간 +0.7%</small>
          </article>
        </div>
        <article className="chart-card">
          <div className="chart-copy">
            <span>월별 추이</span>
            <strong>입원 일수 변화</strong>
          </div>
          <svg
            viewBox="0 0 640 150"
            role="img"
            aria-label="월별 입원 일수 감소 추이"
          >
            <path
              className="chart-grid-line"
              d="M12 28H628 M12 74H628 M12 120H628"
            />
            <path
              className="chart-area"
              d="M12 36 C90 44,118 70,188 62 S298 98,366 80 S470 112,528 88 S592 76,628 56 L628 132 L12 132 Z"
            />
            <path
              className="chart-line"
              d="M12 36 C90 44,118 70,188 62 S298 98,366 80 S470 112,528 88 S592 76,628 56"
            />
          </svg>
        </article>
      </div>
    </div>
  );
}

function DataDesignPreview() {
  return (
    <div className="graph-stage" aria-label="데이터 연결 설계 미리보기">
      <div className="graph-node page-node">
        <span className="node-kicker">PAGE</span>
        <strong>지역별 비교</strong>
        <span className="node-port output" aria-label="페이지 출력 포트" />
      </div>
      <div className="graph-edge edge-one" aria-hidden="true" />
      <div className="graph-node element-node">
        <span className="node-port input" aria-label="엘리먼트 입력 포트" />
        <span className="node-kicker">ELEMENT</span>
        <strong>재원일수 차트</strong>
        <span className="node-port output" aria-label="엘리먼트 출력 포트" />
      </div>
      <div className="graph-edge edge-two" aria-hidden="true" />
      <div className="graph-node database-node">
        <span className="node-port input" aria-label="데이터베이스 입력 포트" />
        <span className="node-kicker">DATABASE</span>
        <strong>regional_health</strong>
        <small>12 fields · SQLite</small>
      </div>
      <div className="graph-note">
        <Waypoints aria-hidden="true" />
        입력: 왼쪽 · 출력: 오른쪽
      </div>
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
              {index < steps.length - 1 && <ChevronRight aria-hidden="true" />}
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
          <div className="element-palette">
            <div className="panel-heading compact">
              <div>
                <strong>엘리먼트</strong>
              </div>
            </div>
            <div className="palette-grid">
              <button type="button">
                <BarChart3 aria-hidden="true" />
                차트
              </button>
              <button type="button">
                <Table2 aria-hidden="true" />
                테이블
              </button>
              <button type="button">
                <Activity aria-hidden="true" />
                지표
              </button>
              <button type="button">
                <Blocks aria-hidden="true" />
                텍스트
              </button>
            </div>
          </div>
        </aside>

        <main className="editor-main">
          <div className="canvas-toolbar">
            <div>
              <span className="canvas-breadcrumb">
                {selectedPage?.name ?? "페이지 없음"}
              </span>
              <strong>{steps.find((item) => item.id === step)?.label}</strong>
            </div>
            <span className="zoom-indicator">100%</span>
          </div>
          {step === "page" &&
            (selectedPage ? (
              <CanvasPreview title={selectedPage.name} />
            ) : (
              <div className="editor-empty-state" role="status">
                <strong>페이지 없음</strong>
                <span>빈 페이지 추가</span>
              </div>
            ))}
          {step === "data" &&
            (selectedPage ? (
              <DataDesignPreview />
            ) : (
              <div className="editor-empty-state" role="status">
                <strong>페이지 필요</strong>
                <span>페이지 단계</span>
              </div>
            ))}
          {step === "validation" && (
            <ValidationPreview pageExists={selectedPage !== null} />
          )}
        </main>

        <aside className="inspector-panel">
          <div className="panel-heading">
            <div>
              <strong>
                {step === "page"
                  ? "페이지 속성"
                  : step === "data"
                    ? "연결 정보"
                    : "검증 요약"}
              </strong>
            </div>
          </div>
          {step === "page" && (
            <div className="inspector-form">
              <label>
                페이지 제목
                <input value={selectedPage?.name ?? ""} readOnly />
              </label>
              <label>
                캔버스 폭
                <select defaultValue="desktop">
                  <option value="desktop">Desktop · 1440px</option>
                  <option value="tablet">Tablet · 768px</option>
                  <option value="mobile">Mobile · 390px</option>
                </select>
              </label>
            </div>
          )}
          {step === "data" && (
            <div className="inspector-summary">
              {selectedPage ? (
                <>
                  <span>
                    <Database aria-hidden="true" />
                    SQLite 연결 1개
                  </span>
                  <span>
                    <Waypoints aria-hidden="true" />
                    실행 바인딩 2개
                  </span>
                </>
              ) : (
                <span>
                  <Clock3 aria-hidden="true" />
                  페이지 필요
                </span>
              )}
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
  );
}

function ProductApp() {
  const [surface, setSurface] = useState<"home" | "editor">("home");
  const [selectedProject, setSelectedProject] = useState<ProjectDto | null>(
    null,
  );
  const [fontSize, setFontSize] = useState(12);
  const [themeId, setThemeId] = useState(defaultTheme.id);

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
        const projectAtRequest = selectedProject;
        setSelectedProject({ ...projectAtRequest, themeId: nextThemeId });
        void updateProject(projectAtRequest.id, {
          expectedRevision: projectAtRequest.revision,
          themeId: nextThemeId,
        })
          .then(setSelectedProject)
          .catch(() => {
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
              current ? { ...current, revision } : current,
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
