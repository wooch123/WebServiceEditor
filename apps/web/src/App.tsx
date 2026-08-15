import {
  Activity,
  ArchiveRestore,
  ArrowLeft,
  BarChart3,
  Blocks,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  Database,
  Download,
  FileBarChart,
  FolderClock,
  FolderHeart,
  Folders,
  Gauge,
  Heart,
  LayoutDashboard,
  Minus,
  Palette,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  Waypoints,
  Wifi,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { lazy, Suspense, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
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
import { NativeSelect } from "@/components/ui/native-select";

import {
  defaultTheme,
  themes,
  themeToCssVariables,
  type ThemeGroup,
} from "./theme";

const DesignSystemGallery = lazy(async () => {
  const gallery = await import("./DesignSystemGallery");
  return { default: gallery.DesignSystemGallery };
});

type HomeSection = "active" | "recent" | "favorites" | "trash" | "backup";
type RuntimeStatus = "online" | "draft" | "offline";
type EditorStep = "page" | "data" | "validation";

interface Project {
  id: string;
  name: string;
  description: string;
  icon: "dashboard" | "quality" | "survey" | "blank";
  draftRevision: number;
  publishedVersion: string;
  lastSaved: string;
  status: RuntimeStatus;
  favorite: boolean;
  pageCount: number;
  elementCount: number;
  tableCount: number;
  trashedAt: string | null;
}

interface HeaderControlsProps {
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  themeId: string;
  onThemeChange: (themeId: string) => void;
}

const initialProjects: Project[] = [
  {
    id: "project-health-monitor",
    name: "지역 건강지표 모니터",
    description: "시군구별 만성질환과 의료 이용 변화를 한눈에 추적합니다.",
    icon: "dashboard",
    draftRevision: 18,
    publishedVersion: "v1.7",
    lastSaved: "오늘 14:32",
    status: "online",
    favorite: true,
    pageCount: 6,
    elementCount: 24,
    tableCount: 4,
    trashedAt: null,
  },
  {
    id: "project-spc-center",
    name: "품질 관리 SPC 센터",
    description:
      "공정 능력과 이상 신호를 팀이 함께 확인하는 운영 대시보드입니다.",
    icon: "quality",
    draftRevision: 9,
    publishedVersion: "v1.2",
    lastSaved: "어제 18:05",
    status: "online",
    favorite: false,
    pageCount: 4,
    elementCount: 19,
    tableCount: 3,
    trashedAt: null,
  },
  {
    id: "project-survey-workbench",
    name: "설문 분석 워크벤치",
    description:
      "응답 데이터 정제부터 교차 분석 보고서까지 이어지는 작업 공간입니다.",
    icon: "survey",
    draftRevision: 4,
    publishedVersion: "게시 전",
    lastSaved: "8월 12일",
    status: "draft",
    favorite: false,
    pageCount: 3,
    elementCount: 11,
    tableCount: 2,
    trashedAt: null,
  },
];

const projectIcons: Record<Project["icon"], LucideIcon> = {
  dashboard: LayoutDashboard,
  quality: Gauge,
  survey: FileBarChart,
  blank: Sparkles,
};

const statusContent: Record<
  RuntimeStatus,
  { label: string; className: string; icon: LucideIcon }
> = {
  online: { label: "운영 중", className: "success", icon: Wifi },
  draft: { label: "게시 전", className: "warning", icon: Clock3 },
  offline: { label: "중지됨", className: "muted", icon: Activity },
};

const navItems: Array<{
  id: HomeSection;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "active", label: "활성 프로젝트", icon: Folders },
  { id: "recent", label: "최근 작업", icon: FolderClock },
  { id: "favorites", label: "즐겨찾기", icon: FolderHeart },
  { id: "trash", label: "휴지통", icon: Trash2 },
  { id: "backup", label: "백업과 복원", icon: ArchiveRestore },
];

const sectionTitles: Record<
  Exclude<HomeSection, "backup">,
  { eyebrow: string; title: string; description: string }
> = {
  active: {
    eyebrow: "PROJECT HOME",
    title: "분석을 서비스로 이어가세요",
    description:
      "페이지 구성부터 데이터 연결, 실제 검증까지 한 작업 공간에서 진행합니다.",
  },
  recent: {
    eyebrow: "RECENT",
    title: "최근 이어서 작업한 프로젝트",
    description: "마지막 저장 시각을 기준으로 정렬했습니다.",
  },
  favorites: {
    eyebrow: "FAVORITES",
    title: "중요 프로젝트",
    description: "즐겨찾기에 표시한 프로젝트만 모았습니다.",
  },
  trash: {
    eyebrow: "RECYCLE BIN",
    title: "휴지통",
    description:
      "프로젝트는 즉시 제거되지 않으며 여기에서 안전하게 복원할 수 있습니다.",
  },
};

function HeaderControls({
  fontSize,
  onFontSizeChange,
  themeId,
  onThemeChange,
}: HeaderControlsProps) {
  const themeGroups: Array<{ id: ThemeGroup; label: string }> = [
    { id: "dark", label: "다크" },
    { id: "gray", label: "그레이" },
    { id: "light", label: "라이트" },
  ];

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

      <label className="theme-control">
        <Palette aria-hidden="true" />
        <span className="sr-only">테마 선택</span>
        <NativeSelect
          aria-label="테마 선택"
          value={themeId}
          onChange={(event) => onThemeChange(event.target.value)}
        >
          {themeGroups.map((group) => (
            <optgroup key={group.id} label={`${group.label} 20종`}>
              {themes
                .filter((theme) => theme.group === group.id)
                .map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </NativeSelect>
      </label>
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
      <span className="early-badge">EARLY</span>
    </div>
  );
}

function ProjectCard({
  project,
  onOpen,
  onDuplicate,
  onExport,
  onFavorite,
  onTrash,
  onRestore,
}: {
  project: Project;
  onOpen: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onFavorite: () => void;
  onTrash: (trigger: HTMLButtonElement) => void;
  onRestore: () => void;
}) {
  const ProjectIcon = projectIcons[project.icon];
  const status = statusContent[project.status];
  const StatusIcon = status.icon;
  const isTrashed = project.trashedAt !== null;

  return (
    <article className="project-card">
      <div className="project-card-accent" aria-hidden="true" />
      <div className="project-card-topline">
        <span className="project-icon">
          <ProjectIcon aria-hidden="true" />
        </span>
        {!isTrashed && (
          <button
            type="button"
            className={`icon-button favorite-button ${project.favorite ? "is-active" : ""}`}
            aria-label={`${project.name} ${project.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}`}
            aria-pressed={project.favorite}
            onClick={onFavorite}
          >
            <Heart aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="project-card-copy">
        <h2>{project.name}</h2>
        <p>{project.description}</p>
      </div>

      <dl className="project-metadata">
        <div>
          <dt>초안</dt>
          <dd>r{project.draftRevision}</dd>
        </div>
        <div>
          <dt>게시 버전</dt>
          <dd>{project.publishedVersion}</dd>
        </div>
        <div>
          <dt>마지막 저장</dt>
          <dd>{project.lastSaved}</dd>
        </div>
      </dl>

      <div className="project-card-footer">
        {isTrashed ? (
          <>
            <span className="trash-date">삭제 {project.trashedAt}</span>
            <button
              className="button secondary"
              type="button"
              onClick={onRestore}
            >
              <ArchiveRestore aria-hidden="true" />
              복원
            </button>
          </>
        ) : (
          <>
            <span className={`status-badge ${status.className}`}>
              <StatusIcon aria-hidden="true" />
              {status.label}
            </span>
            <div className="project-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={`${project.name} 복제`}
                title="복제"
                onClick={onDuplicate}
              >
                <Copy aria-hidden="true" />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label={`${project.name} 내보내기`}
                title="내보내기"
                onClick={onExport}
              >
                <Download aria-hidden="true" />
              </button>
              <button
                className="icon-button destructive-ghost"
                type="button"
                aria-label={`${project.name} 휴지통으로 이동`}
                title="휴지통으로 이동"
                onClick={(event) => onTrash(event.currentTarget)}
              >
                <Trash2 aria-hidden="true" />
              </button>
              <button className="button primary" type="button" onClick={onOpen}>
                편집 열기
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function BackupPanel({
  projects,
  onExport,
}: {
  projects: Project[];
  onExport: () => void;
}) {
  const activeProjects = projects.filter(
    (project) => project.trashedAt === null,
  );

  return (
    <section className="backup-panel" aria-labelledby="backup-title">
      <span className="section-eyebrow">BACKUP &amp; RESTORE</span>
      <div className="backup-card">
        <span className="backup-icon">
          <ArchiveRestore aria-hidden="true" />
        </span>
        <div>
          <h1 id="backup-title">프로젝트 정의 백업</h1>
          <p>
            활성 프로젝트 {activeProjects.length}개의 현재 화면 정의를 JSON으로
            내보냅니다. 데이터베이스 파일 백업은 서버 수직 슬라이스에서 별도
            검증됩니다.
          </p>
        </div>
        <button className="button primary" type="button" onClick={onExport}>
          <Download aria-hidden="true" />
          정의 내보내기
        </button>
      </div>
    </section>
  );
}

function HomeSurface({
  projects,
  setProjects,
  onOpenProject,
  controls,
}: {
  projects: Project[];
  setProjects: (projects: Project[]) => void;
  onOpenProject: (projectId: string) => void;
  controls: HeaderControlsProps;
}) {
  const [section, setSection] = useState<HomeSection>("active");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"saved" | "name">("saved");
  const [pendingTrashId, setPendingTrashId] = useState<string | null>(null);
  const trashTriggerRef = useRef<HTMLButtonElement | null>(null);

  const activeCount = projects.filter(
    (project) => project.trashedAt === null,
  ).length;
  const favoriteCount = projects.filter(
    (project) => project.favorite && project.trashedAt === null,
  ).length;
  const trashCount = projects.filter(
    (project) => project.trashedAt !== null,
  ).length;

  const counts: Record<HomeSection, number | null> = {
    active: activeCount,
    recent: activeCount,
    favorites: favoriteCount,
    trash: trashCount,
    backup: null,
  };

  const visibleProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko");
    let filtered = projects.filter((project) => {
      if (section === "trash") return project.trashedAt !== null;
      if (project.trashedAt !== null) return false;
      if (section === "favorites" && !project.favorite) return false;
      return true;
    });

    if (normalizedQuery) {
      filtered = filtered.filter((project) =>
        `${project.name} ${project.description}`
          .toLocaleLowerCase("ko")
          .includes(normalizedQuery),
      );
    }

    return [...filtered].sort((left, right) =>
      sort === "name" ? left.name.localeCompare(right.name, "ko") : 0,
    );
  }, [projects, query, section, sort]);

  const updateProject = (projectId: string, update: Partial<Project>) => {
    setProjects(
      projects.map((project) =>
        project.id === projectId ? { ...project, ...update } : project,
      ),
    );
  };

  const download = (filename: string, payload: unknown) => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const createProject = () => {
    const project: Project = {
      id: `project-${Date.now()}`,
      name: `새 통계 서비스 ${activeCount + 1}`,
      description: "페이지와 데이터 흐름을 설계할 새 작업 공간입니다.",
      icon: "blank",
      draftRevision: 1,
      publishedVersion: "게시 전",
      lastSaved: "방금",
      status: "draft",
      favorite: false,
      pageCount: 1,
      elementCount: 0,
      tableCount: 0,
      trashedAt: null,
    };
    setProjects([project, ...projects]);
    onOpenProject(project.id);
  };

  const duplicateProject = (project: Project) => {
    const duplicate: Project = {
      ...project,
      id: `${project.id}-copy-${Date.now()}`,
      name: `${project.name} 복사본`,
      draftRevision: 1,
      publishedVersion: "게시 전",
      lastSaved: "방금",
      status: "draft",
      favorite: false,
    };
    setProjects([duplicate, ...projects]);
  };

  const pendingProject = projects.find(
    (project) => project.id === pendingTrashId,
  );

  return (
    <div className="surface home-surface">
      <header className="app-header">
        <Brand />
        <div className="header-location">
          <span>작업 공간</span>
          <ChevronRight aria-hidden="true" />
          <strong>프로젝트 홈</strong>
        </div>
        <HeaderControls {...controls} />
      </header>

      <div className="home-layout">
        <aside className="home-sidebar">
          <nav aria-label="프로젝트 홈">
            <p className="nav-label">WORKSPACE</p>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`sidebar-nav-item ${section === item.id ? "is-active" : ""}`}
                  aria-current={section === item.id ? "page" : undefined}
                  onClick={() => setSection(item.id)}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                  {counts[item.id] !== null && (
                    <span className="nav-count">{counts[item.id]}</span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="sidebar-guide">
            <span className="guide-icon">
              <Waypoints aria-hidden="true" />
            </span>
            <div>
              <strong>3단계 제작 흐름</strong>
              <p>페이지 → 데이터 → 실제 검증</p>
            </div>
          </div>
        </aside>

        <main className="home-main">
          {section === "backup" ? (
            <BackupPanel
              projects={projects}
              onExport={() => download("webeditor-projects.json", projects)}
            />
          ) : (
            <>
              <section className="home-hero" aria-labelledby="home-title">
                <div>
                  <span className="section-eyebrow">
                    {sectionTitles[section].eyebrow}
                  </span>
                  <h1 id="home-title">{sectionTitles[section].title}</h1>
                  <p>{sectionTitles[section].description}</p>
                </div>
                {section !== "trash" && (
                  <button
                    className="button primary create-button"
                    type="button"
                    onClick={createProject}
                  >
                    <Plus aria-hidden="true" />새 프로젝트
                  </button>
                )}
              </section>

              <div className="project-toolbar">
                <label className="search-field">
                  <Search aria-hidden="true" />
                  <span className="sr-only">프로젝트 검색</span>
                  <input
                    type="search"
                    value={query}
                    placeholder="프로젝트 이름 또는 설명 검색"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query && (
                    <button
                      type="button"
                      aria-label="검색어 지우기"
                      onClick={() => setQuery("")}
                    >
                      <X aria-hidden="true" />
                    </button>
                  )}
                </label>
                <label className="sort-field">
                  <span className="sr-only">프로젝트 정렬</span>
                  <select
                    aria-label="프로젝트 정렬"
                    value={sort}
                    onChange={(event) =>
                      setSort(event.target.value as "saved" | "name")
                    }
                  >
                    <option value="saved">최근 저장순</option>
                    <option value="name">이름순</option>
                  </select>
                </label>
              </div>

              <section className="project-grid" aria-label="프로젝트 목록">
                {visibleProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onOpen={() => onOpenProject(project.id)}
                    onDuplicate={() => duplicateProject(project)}
                    onExport={() => download(`${project.id}.json`, project)}
                    onFavorite={() =>
                      updateProject(project.id, { favorite: !project.favorite })
                    }
                    onTrash={(trigger) => {
                      trashTriggerRef.current = trigger;
                      setPendingTrashId(project.id);
                    }}
                    onRestore={() =>
                      updateProject(project.id, { trashedAt: null })
                    }
                  />
                ))}
                {visibleProjects.length === 0 && (
                  <div className="empty-state">
                    <Search aria-hidden="true" />
                    <h2>표시할 프로젝트가 없습니다</h2>
                    <p>
                      {query
                        ? "다른 검색어를 입력해 보세요."
                        : "이 분류에는 아직 프로젝트가 없습니다."}
                    </p>
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>

      <AlertDialog
        open={pendingProject !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingTrashId(null);
        }}
      >
        {pendingProject && (
          <AlertDialogContent
            className="dialog"
            onCloseAutoFocus={(event) => {
              const trigger = trashTriggerRef.current;
              if (trigger?.isConnected) {
                event.preventDefault();
                trigger.focus();
              }
            }}
          >
            <AlertDialogMedia className="dialog-icon destructive">
              <Trash2 aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogHeader>
              <AlertDialogTitle>휴지통으로 이동할까요?</AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogDescription>
              <strong>{pendingProject.name}</strong>의 운영 접근이 중단됩니다.
              정의와 연결 정보는 휴지통에 보존되며 다시 복원할 수 있습니다.
            </AlertDialogDescription>
            <dl className="impact-summary">
              <div>
                <dt>페이지</dt>
                <dd>{pendingProject.pageCount}</dd>
              </div>
              <div>
                <dt>엘리먼트</dt>
                <dd>{pendingProject.elementCount}</dd>
              </div>
              <div>
                <dt>테이블</dt>
                <dd>{pendingProject.tableCount}</dd>
              </div>
            </dl>
            <AlertDialogFooter className="dialog-actions">
              <AlertDialogCancel
                className="button secondary"
                onClick={() => setPendingTrashId(null)}
              >
                취소
              </AlertDialogCancel>
              <AlertDialogAction
                className="button destructive"
                variant="destructive"
                onClick={() => {
                  updateProject(pendingProject.id, { trashedAt: "방금" });
                  setPendingTrashId(null);
                }}
              >
                <Trash2 aria-hidden="true" />
                휴지통으로 이동
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}

const editorPages = [
  { id: "overview", name: "운영 개요", icon: LayoutDashboard, status: "완료" },
  { id: "region", name: "지역별 비교", icon: BarChart3, status: "편집 중" },
  { id: "records", name: "원자료 조회", icon: Table2, status: "연결 필요" },
];

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
            데이터 연결됨
          </span>
        </div>
        <div className="metric-grid">
          <article className="metric-card is-selected">
            <span>평균 재원일수</span>
            <strong>8.4일</strong>
            <small>전월 대비 4.2% 감소</small>
            <i className="resize-dot top-left" />
            <i className="resize-dot top-right" />
            <i className="resize-dot bottom-left" />
            <i className="resize-dot bottom-right" />
          </article>
          <article className="metric-card">
            <span>고위험군 비율</span>
            <strong>12.8%</strong>
            <small>목표 범위 안</small>
          </article>
          <article className="metric-card">
            <span>데이터 완성도</span>
            <strong>98.6%</strong>
            <small>어제보다 0.7% 상승</small>
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
        입력은 왼쪽, 출력은 오른쪽에 고정됩니다.
      </div>
    </div>
  );
}

function ValidationPreview() {
  const checks = [
    ["페이지 구조", "3/3 통과"],
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
          <span className="node-kicker">TEST &amp; VALIDATION</span>
          <h2>게시 전에 실제 데이터 흐름을 확인합니다</h2>
          <p>
            현재 UI 조각은 검증 항목을 보여주며, 실행 엔진 연결은 후속 단계에서
            진행됩니다.
          </p>
        </div>
      </div>
      <div className="validation-list">
        {checks.map(([label, result], index) => (
          <div key={label}>
            <span className={index === 0 ? "check-complete" : "check-pending"}>
              {index === 0 ? (
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
  controls,
}: {
  project: Project;
  onBack: () => void;
  controls: HeaderControlsProps;
}) {
  const [step, setStep] = useState<EditorStep>("page");
  const [pageId, setPageId] = useState("overview");
  const [pageTitle, setPageTitle] = useState("지역 건강지표 개요");
  const [saved, setSaved] = useState(true);

  const steps: Array<{
    id: EditorStep;
    number: string;
    label: string;
    icon: LucideIcon;
  }> = [
    { id: "page", number: "01", label: "페이지 디자인", icon: LayoutDashboard },
    { id: "data", number: "02", label: "데이터 디자인", icon: Database },
    {
      id: "validation",
      number: "03",
      label: "테스트와 검증",
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
          {saved ? "저장됨" : "변경 저장"}
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
          <div className="panel-heading">
            <div>
              <span>PROJECT PAGES</span>
              <strong>페이지</strong>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="새 페이지 추가"
            >
              <Plus aria-hidden="true" />
            </button>
          </div>
          <div className="page-list">
            {editorPages.map((page) => {
              const PageIcon = page.icon;
              return (
                <button
                  key={page.id}
                  className={pageId === page.id ? "is-active" : ""}
                  type="button"
                  aria-current={pageId === page.id ? "page" : undefined}
                  onClick={() => setPageId(page.id)}
                >
                  <PageIcon aria-hidden="true" />
                  <span>
                    <strong>{page.name}</strong>
                    <small>{page.status}</small>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="element-palette">
            <div className="panel-heading compact">
              <div>
                <span>ELEMENTS</span>
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
                페이지 / {editorPages.find((page) => page.id === pageId)?.name}
              </span>
              <strong>{steps.find((item) => item.id === step)?.label}</strong>
            </div>
            <span className="zoom-indicator">100%</span>
          </div>
          {step === "page" && <CanvasPreview title={pageTitle} />}
          {step === "data" && <DataDesignPreview />}
          {step === "validation" && <ValidationPreview />}
        </main>

        <aside className="inspector-panel">
          <div className="panel-heading">
            <div>
              <span>INSPECTOR</span>
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
                <input
                  value={pageTitle}
                  onChange={(event) => {
                    setPageTitle(event.target.value);
                    setSaved(false);
                  }}
                />
              </label>
              <label>
                캔버스 폭
                <select defaultValue="desktop">
                  <option value="desktop">Desktop · 1440px</option>
                  <option value="tablet">Tablet · 768px</option>
                  <option value="mobile">Mobile · 390px</option>
                </select>
              </label>
              <div className="inspector-note">
                <Sparkles aria-hidden="true" />
                <p>선택한 요소의 배치와 스타일 속성이 이 영역에 표시됩니다.</p>
              </div>
            </div>
          )}
          {step === "data" && (
            <div className="inspector-summary">
              <span>
                <Database aria-hidden="true" />
                SQLite 연결 1개
              </span>
              <span>
                <Waypoints aria-hidden="true" />
                실행 바인딩 2개
              </span>
              <p>안정적인 ID로 연결을 저장하며 표시 이름 변경과 분리합니다.</p>
            </div>
          )}
          {step === "validation" && (
            <div className="inspector-summary">
              <span>
                <Check aria-hidden="true" />
                통과 3
              </span>
              <span>
                <Clock3 aria-hidden="true" />
                확인 필요 2
              </span>
              <p>
                실제 샘플 데이터 입출력 전에는 게시 가능 상태로 표시하지
                않습니다.
              </p>
            </div>
          )}
        </aside>
      </div>

      <footer className="editor-statusbar">
        <span>
          <span className="connection-dot" />
          Local API 연결
        </span>
        <span aria-live="polite">
          {saved ? "모든 변경사항 저장됨" : "저장되지 않은 변경사항"}
        </span>
        <span>Draft r{project.draftRevision}</span>
      </footer>
    </div>
  );
}

function ProductApp() {
  const [projects, setProjects] = useState(initialProjects);
  const [surface, setSurface] = useState<"home" | "editor">("home");
  const [selectedProjectId, setSelectedProjectId] = useState(
    initialProjects[0]?.id ?? "",
  );
  const [fontSize, setFontSize] = useState(12);
  const [themeId, setThemeId] = useState(defaultTheme.id);

  const selectedTheme =
    themes.find((theme) => theme.id === themeId) ?? defaultTheme;
  const selectedProject = projects.find(
    (project) => project.id === selectedProjectId,
  );
  const controls: HeaderControlsProps = {
    fontSize,
    onFontSizeChange: setFontSize,
    themeId,
    onThemeChange: setThemeId,
  };
  const appStyle = {
    ...themeToCssVariables(selectedTheme),
    "--app-base-font-size": `${fontSize}px`,
  } as CSSProperties;

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
          controls={controls}
        />
      ) : (
        <HomeSurface
          projects={projects}
          setProjects={setProjects}
          onOpenProject={(projectId) => {
            setSelectedProjectId(projectId);
            setSurface("editor");
          }}
          controls={controls}
        />
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
            디자인 시스템을 불러오는 중입니다.
          </div>
        }
      >
        <DesignSystemGallery />
      </Suspense>
    );
  }

  return <ProductApp />;
}
