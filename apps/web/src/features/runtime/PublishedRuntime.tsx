import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Menu,
  Minus,
  Plus,
  Search,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { ThemePicker } from "@/ThemePicker";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  getRuntimeNavigation,
  type RuntimeNavigationDto,
  type RuntimePageDto,
} from "@/services/pages-api";
import { defaultTheme, themes, themeToCssVariables } from "@/theme";
import { DynamicLucideIcon } from "@/features/pages/DynamicLucideIcon";

const SEARCH_THRESHOLD = 30;

function cleanRoute(route: string) {
  return route.replace(/^\/+|\/+$/g, "");
}

function runtimePath(projectId: string, route: string) {
  const encodedRoute = cleanRoute(route)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `/runtime/${encodeURIComponent(projectId)}/${encodedRoute}`;
}

interface NavigationProps {
  pages: RuntimePageDto[];
  activePage: RuntimePageDto | null;
  collapsed: boolean;
  onNavigate: (page: RuntimePageDto) => void;
}

function RuntimeNavigation({
  pages,
  activePage,
  collapsed,
  onNavigate,
}: NavigationProps) {
  const [query, setQuery] = useState("");
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const searchable = pages.length >= SEARCH_THRESHOLD;
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return pages.filter(
      (page) =>
        page.navigationVisible &&
        (!normalized || page.name.toLocaleLowerCase().includes(normalized)),
    );
  }, [pages, query]);
  const groups = useMemo(() => {
    const map = new Map<string, RuntimePageDto[]>();
    for (const page of visible) {
      const group = page.navigationGroup?.trim() || "페이지";
      map.set(group, [...(map.get(group) ?? []), page]);
    }
    return [...map.entries()];
  }, [visible]);

  function pageButton(page: RuntimePageDto) {
    const active = activePage?.id === page.id;
    const button = (
      <button
        key={page.id}
        className={cn("runtime-nav-item", active && "is-active")}
        type="button"
        aria-label={collapsed ? page.name : undefined}
        aria-current={active ? "page" : undefined}
        onClick={() => onNavigate(page)}
      >
        <DynamicLucideIcon iconName={page.iconName} />
        {!collapsed && <span>{page.name}</span>}
      </button>
    );
    if (!collapsed) return button;
    return (
      <Tooltip key={page.id}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right">{page.name}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <TooltipProvider>
      <nav className="runtime-navigation" aria-label="페이지 탐색">
        {searchable && !collapsed && (
          <label className="runtime-search">
            <Search aria-hidden="true" />
            <span className="sr-only">페이지 검색</span>
            <Input
              value={query}
              placeholder="검색"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        )}
        {groups.map(([group, groupPages]) => {
          if (!searchable || collapsed) {
            return (
              <div className="runtime-nav-group" key={group}>
                {groupPages.map(pageButton)}
              </div>
            );
          }
          const open = !closedGroups.has(group);
          return (
            <Collapsible
              key={group}
              open={open}
              onOpenChange={(nextOpen) => {
                setClosedGroups((current) => {
                  const next = new Set(current);
                  if (nextOpen) next.delete(group);
                  else next.add(group);
                  return next;
                });
              }}
            >
              <CollapsibleTrigger asChild>
                <Button
                  className="runtime-group-trigger"
                  variant="ghost"
                  type="button"
                >
                  {group}
                  <ChevronDown data-icon="inline-end" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="runtime-nav-group">
                {groupPages.map(pageButton)}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
        {visible.length === 0 && !collapsed && (
          <p className="runtime-nav-empty">결과 없음</p>
        )}
      </nav>
    </TooltipProvider>
  );
}

function RuntimeControls({
  fontSize,
  onFontSizeChange,
  themeId,
  onThemeChange,
}: {
  fontSize: number;
  onFontSizeChange: (value: number) => void;
  themeId: string;
  onThemeChange: (value: string) => void;
}) {
  return (
    <div
      className="header-controls runtime-controls"
      aria-label="화면 표시 설정"
    >
      <div className="font-size-control" aria-label="글꼴 크기">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="글꼴 크기 줄이기"
          disabled={fontSize === 10}
          onClick={() => onFontSizeChange(Math.max(10, fontSize - 1))}
        >
          <Minus />
        </Button>
        <output aria-label="현재 글꼴 크기">{fontSize}px</output>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="글꼴 크기 늘리기"
          disabled={fontSize === 24}
          onClick={() => onFontSizeChange(Math.min(24, fontSize + 1))}
        >
          <Plus />
        </Button>
      </div>
      <ThemePicker themeId={themeId} onThemeChange={onThemeChange} />
    </div>
  );
}

function RuntimeShell({
  navigation,
  activePage,
  onNavigate,
}: {
  navigation: RuntimeNavigationDto;
  activePage: RuntimePageDto | null;
  onNavigate: (page: RuntimePageDto) => void;
}) {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fontSize, setFontSize] = useState(12);
  const [themeId, setThemeId] = useState(defaultTheme.id);
  const selectedTheme =
    themes.find((theme) => theme.id === themeId) ?? defaultTheme;

  useLayoutEffect(() => {
    const variables = themeToCssVariables(selectedTheme);
    const root = document.documentElement;
    for (const [name, value] of Object.entries(variables))
      root.style.setProperty(name, value);
    root.dataset.webeditorThemeId = selectedTheme.id;
  }, [selectedTheme]);

  const style = {
    ...themeToCssVariables(selectedTheme),
    "--app-base-font-size": `${fontSize}px`,
  } as CSSProperties;

  const navigationNode = (
    <RuntimeNavigation
      pages={navigation.pages}
      activePage={activePage}
      collapsed={collapsed && !isMobile}
      onNavigate={(page) => {
        onNavigate(page);
        setDrawerOpen(false);
      }}
    />
  );

  return (
    <div
      className="webeditor-app runtime-app"
      style={style}
      data-theme-id={themeId}
    >
      <header className="app-header runtime-header">
        {isMobile && (
          <Drawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            direction="left"
          >
            <DrawerTrigger asChild>
              <Button variant="outline" size="icon" aria-label="탐색 열기">
                <Menu />
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>페이지</DrawerTitle>
                <DrawerDescription>게시된 페이지</DrawerDescription>
              </DrawerHeader>
              {navigationNode}
              <DrawerClose asChild>
                <Button className="runtime-drawer-close" variant="outline">
                  닫기
                </Button>
              </DrawerClose>
            </DrawerContent>
          </Drawer>
        )}
        <strong className="runtime-app-name">WebEditor</strong>
        <span className="runtime-breadcrumb">
          {activePage?.name ?? "페이지 없음"}
        </span>
        <RuntimeControls
          fontSize={fontSize}
          onFontSizeChange={setFontSize}
          themeId={themeId}
          onThemeChange={setThemeId}
        />
      </header>
      <div className={cn("runtime-layout", collapsed && "is-collapsed")}>
        {!isMobile && (
          <aside className="runtime-sidebar">
            <div className="runtime-sidebar-heading">
              {!collapsed && <strong>페이지</strong>}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={collapsed ? "탐색 펼치기" : "탐색 접기"}
                onClick={() => setCollapsed((value) => !value)}
              >
                {collapsed ? <ChevronRight /> : <ChevronLeft />}
              </Button>
            </div>
            {navigationNode}
          </aside>
        )}
        <main className="runtime-page" tabIndex={-1}>
          {activePage ? (
            <article>
              <DynamicLucideIcon iconName={activePage.iconName} />
              <h1>{activePage.name}</h1>
              {!activePage.navigationVisible && <p>직접 링크</p>}
            </article>
          ) : (
            <div className="runtime-not-found" role="alert">
              <h1>페이지 없음</h1>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export function PublishedRuntime() {
  const params = useParams<{ projectId: string; "*": string }>();
  const projectId = params.projectId ?? "";
  const route = cleanRoute(params["*"] ?? "");
  const location = useLocation();
  const navigate = useNavigate();
  const [navigation, setNavigation] = useState<RuntimeNavigationDto | null>(
    null,
  );
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setError("");
    void getRuntimeNavigation(projectId)
      .then((payload) => {
        if (active)
          setNavigation({
            ...payload,
            pages: [...payload.pages].sort((a, b) => a.sortOrder - b.sortOrder),
          });
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "런타임 오류");
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const activePage =
    navigation?.pages.find((page) => cleanRoute(page.route) === route) ?? null;

  useEffect(() => {
    if (!navigation || route) return;
    const first =
      navigation.pages.find((page) => page.navigationVisible) ??
      navigation.pages[0];
    if (first) navigate(runtimePath(projectId, first.route), { replace: true });
  }, [navigate, navigation, projectId, route]);

  if (error)
    return (
      <main className="runtime-load-state" role="alert">
        <h1>런타임 오류</h1>
        <p>{error}</p>
      </main>
    );
  if (!navigation)
    return (
      <main className="runtime-load-state" role="status">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </main>
    );

  return (
    <RuntimeShell
      navigation={navigation}
      activePage={activePage}
      onNavigate={(page) => {
        const next = runtimePath(projectId, page.route);
        if (next !== location.pathname) navigate(next);
      }}
    />
  );
}
