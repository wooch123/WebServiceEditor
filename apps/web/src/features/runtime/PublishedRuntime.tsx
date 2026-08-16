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
import type {
  BindingMutationOperation,
  BindingRenderDataDto,
  BindingScalar,
  RelationshipBindingDto,
} from "@webeditor/domain";

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
  getDraftRuntimeNavigation,
  getRuntimeNavigation,
  type DraftRuntimeNavigationDto,
  type RuntimeNavigationDto,
  type RuntimePageDto,
} from "@/services/pages-api";
import {
  listElementRegistry,
  type ElementDefinitionDto,
  type ElementRegistryDto,
  type ElementType,
} from "@/services/elements-api";
import {
  executeDraftRuntimeBinding,
  executeDraftRuntimeMutation,
  executePublishedRuntimeBinding,
  executePublishedRuntimeMutation,
  getDraftRuntimePage,
  getPublishedRuntimeDefinitionPage,
  RuntimeApiError,
  type RuntimeDefinitionPage,
} from "@/services/runtime-api";
import { defaultTheme, themes, themeToCssVariables } from "@/theme";
import { DynamicLucideIcon } from "@/features/pages/DynamicLucideIcon";
import {
  assertRuntimeRendererDefinitions,
  RuntimeElementRenderer,
} from "./RuntimeElementRenderer";

const SEARCH_THRESHOLD = 30;

function cleanRoute(route: string) {
  return route.replace(/^\/+|\/+$/g, "");
}

function runtimePath(basePath: string, route: string) {
  const encodedRoute = cleanRoute(route)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `${basePath}/${encodedRoute}`;
}

type RuntimeNavigationPayload =
  RuntimeNavigationDto | DraftRuntimeNavigationDto;

interface RuntimeElementData {
  readonly renderState: "EMPTY" | "LOADING" | "ERROR" | "DATA";
  readonly renderData?: BindingRenderDataDto;
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
  runtimePage,
  runtimeElementData,
  runtimePageLoading,
  runtimePageError,
  definitionByType,
  preview,
  formValues,
  fieldErrors,
  pendingElementId,
  mutationMessage,
  onValueChange,
  onAction,
  onNavigate,
}: {
  navigation: RuntimeNavigationPayload;
  activePage: RuntimePageDto | null;
  runtimePage: RuntimeDefinitionPage | null;
  runtimeElementData: ReadonlyMap<string, RuntimeElementData>;
  runtimePageLoading: boolean;
  runtimePageError: string;
  definitionByType: ReadonlyMap<ElementType, ElementDefinitionDto>;
  preview: boolean;
  formValues: Readonly<Record<string, BindingScalar>>;
  fieldErrors: Readonly<Record<string, string>>;
  pendingElementId: string | null;
  mutationMessage: string;
  onValueChange: (elementId: string, value: BindingScalar) => void;
  onAction: (elementId: string) => void;
  onNavigate: (page: RuntimePageDto) => void;
}) {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fontSize, setFontSize] = useState(12);
  const [themeId, setThemeId] = useState(navigation.themeId ?? defaultTheme.id);
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
        {preview && <span className="runtime-preview-badge">미리보기</span>}
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
            runtimePageError ? (
              <div className="runtime-not-found" role="alert">
                <h1>페이지 오류</h1>
                <p>{runtimePageError}</p>
              </div>
            ) : runtimePageLoading || !runtimePage ? (
              <div className="runtime-page-loading" role="status">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-64 w-full" />
              </div>
            ) : (
              <article>
                <header className="runtime-page-heading">
                  <DynamicLucideIcon iconName={runtimePage.page.iconName} />
                  <h1>{runtimePage.page.name}</h1>
                  {!runtimePage.page.navigationVisible && <p>직접 링크</p>}
                </header>
                {mutationMessage && (
                  <p className="runtime-mutation-message" role="status">
                    {mutationMessage}
                  </p>
                )}
                <div
                  className="runtime-elements"
                  role="region"
                  aria-label={preview ? "초안 엘리먼트" : "게시 엘리먼트"}
                >
                  {runtimePage.elements.map((entry) => {
                    const definition = definitionByType.get(entry.element.type);
                    if (!definition) return null;
                    const data = runtimeElementData.get(entry.element.id);
                    return (
                      <div
                        className="runtime-element-grid-item"
                        style={{
                          gridColumn: `${entry.layout.x + 1} / span ${entry.layout.w}`,
                          gridRow: `${entry.layout.y + 1} / span ${entry.layout.h}`,
                        }}
                        key={entry.element.id}
                      >
                        <RuntimeElementRenderer
                          entry={entry}
                          definition={definition}
                          {...(data ? { renderState: data.renderState } : {})}
                          {...(data?.renderData
                            ? { renderData: data.renderData }
                            : {})}
                          {...(Object.hasOwn(formValues, entry.element.id)
                            ? { value: formValues[entry.element.id] }
                            : {})}
                          {...(fieldErrors[entry.element.id]
                            ? { fieldError: fieldErrors[entry.element.id] }
                            : {})}
                          pending={pendingElementId !== null}
                          onValueChange={onValueChange}
                          onAction={onAction}
                        />
                      </div>
                    );
                  })}
                </div>
              </article>
            )
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

function RuntimeApplication({
  projectId,
  previewId,
}: {
  projectId: string;
  previewId?: string;
}) {
  const params = useParams<{ "*": string }>();
  const preview = previewId !== undefined;
  const sourceId = preview ? previewId : projectId;
  const basePath = preview
    ? `/preview/${encodeURIComponent(projectId)}/${encodeURIComponent(previewId)}`
    : `/runtime/${encodeURIComponent(projectId)}`;
  const route = cleanRoute(params["*"] ?? "");
  const location = useLocation();
  const navigate = useNavigate();
  const [navigation, setNavigation] = useState<RuntimeNavigationPayload | null>(
    null,
  );
  const [registry, setRegistry] = useState<ElementRegistryDto | null>(null);
  const [runtimePage, setRuntimePage] = useState<RuntimeDefinitionPage | null>(
    null,
  );
  const [runtimeElementData, setRuntimeElementData] = useState<
    ReadonlyMap<string, RuntimeElementData>
  >(new Map());
  const [runtimePageLoading, setRuntimePageLoading] = useState(false);
  const [runtimePageError, setRuntimePageError] = useState("");
  const [error, setError] = useState("");
  const [formValues, setFormValues] = useState<
    Readonly<Record<string, BindingScalar>>
  >({});
  const [fieldErrors, setFieldErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const [pendingElementId, setPendingElementId] = useState<string | null>(null);
  const [mutationMessage, setMutationMessage] = useState("");
  const [readRefreshRevision, setReadRefreshRevision] = useState(0);
  const retryKeys = useMemo(() => new Map<string, string>(), [runtimePage]);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void Promise.all([
      preview
        ? getDraftRuntimeNavigation(sourceId)
        : getRuntimeNavigation(sourceId),
      listElementRegistry(controller.signal),
    ])
      .then(([navigationPayload, registryPayload]) => {
        assertRuntimeRendererDefinitions(registryPayload.definitions);
        if (!controller.signal.aborted) {
          if (navigationPayload.projectId !== projectId) {
            throw new Error("프로젝트 불일치");
          }
          setNavigation({
            ...navigationPayload,
            pages: [...navigationPayload.pages].sort(
              (a, b) => a.sortOrder - b.sortOrder,
            ),
          });
          setRegistry(registryPayload);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "런타임 오류");
      });
    return () => {
      controller.abort();
    };
  }, [preview, projectId, sourceId]);

  const activePage =
    navigation?.pages.find((page) => cleanRoute(page.route) === route) ?? null;

  useEffect(() => {
    if (!navigation || route) return;
    const first =
      navigation.pages.find((page) => page.navigationVisible) ??
      navigation.pages[0];
    if (first) navigate(runtimePath(basePath, first.route), { replace: true });
  }, [basePath, navigate, navigation, route]);

  useEffect(() => {
    if (!navigation || !activePage) {
      setRuntimePage(null);
      setRuntimePageError("");
      setRuntimePageLoading(false);
      return;
    }
    const controller = new AbortController();
    setRuntimePage(null);
    setRuntimeElementData(new Map());
    setRuntimePageError("");
    setRuntimePageLoading(true);
    const request = preview
      ? getDraftRuntimePage(sourceId, activePage.id, controller.signal)
      : getPublishedRuntimeDefinitionPage(
          sourceId,
          activePage.id,
          controller.signal,
        );
    void request
      .then((payload) => {
        if (controller.signal.aborted) return;
        if (
          payload.snapshotId !== navigation.snapshotId &&
          !(
            "versionId" in payload &&
            "versionId" in navigation &&
            payload.versionId === navigation.versionId
          )
        ) {
          throw new Error("런타임 버전 불일치");
        }
        if (
          navigation.definitionChecksum !== undefined &&
          payload.definitionChecksum !== navigation.definitionChecksum
        ) {
          throw new Error("런타임 정의 불일치");
        }
        setRuntimePage(payload);
        setFormValues(
          Object.fromEntries(
            payload.elements
              .filter(({ element }) => element.type === "number-input")
              .map(({ element }) => {
                const candidate = element.props.defaultValue;
                return [
                  element.id,
                  typeof candidate === "number" && Number.isFinite(candidate)
                    ? candidate
                    : null,
                ];
              }),
          ),
        );
        setFieldErrors({});
        setPendingElementId(null);
        setMutationMessage("");
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setRuntimePageError(
            reason instanceof Error ? reason.message : "페이지 오류",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRuntimePageLoading(false);
      });
    return () => controller.abort();
  }, [activePage, navigation, preview, sourceId]);

  useEffect(() => {
    if (!runtimePage) {
      setRuntimeElementData(new Map());
      return;
    }
    const bindings = (runtimePage.bindings ?? []).filter(
      (binding: RelationshipBindingDto) =>
        binding.bindingType === "READ" && binding.status === "READY",
    );
    const loading = new Map<string, RuntimeElementData>();
    for (const binding of bindings) {
      loading.set(binding.target.objectId, { renderState: "LOADING" });
    }
    setRuntimeElementData(loading);
    if (bindings.length === 0) return;
    const controller = new AbortController();
    for (const binding of bindings) {
      const execution = preview
        ? executeDraftRuntimeBinding(sourceId, binding.id, controller.signal)
        : executePublishedRuntimeBinding(
            sourceId,
            binding.id,
            controller.signal,
          );
      void execution
        .then((payload) => {
          if (controller.signal.aborted) return;
          if (payload.snapshotId !== runtimePage.snapshotId) {
            throw new Error("데이터 버전 불일치");
          }
          if (payload.definitionChecksum !== runtimePage.definitionChecksum) {
            throw new Error("데이터 정의 불일치");
          }
          setRuntimeElementData((current) => {
            const next = new Map(current);
            next.set(payload.targetElementId, {
              renderState: payload.result.renderState,
              renderData: payload.result.renderData,
            });
            return next;
          });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setRuntimeElementData((current) => {
            const next = new Map(current);
            next.set(binding.target.objectId, { renderState: "ERROR" });
            return next;
          });
        });
    }
    return () => controller.abort();
  }, [preview, readRefreshRevision, runtimePage, sourceId]);

  const onValueChange = (elementId: string, value: BindingScalar) => {
    setFormValues((current) => ({ ...current, [elementId]: value }));
    setFieldErrors((current) => {
      if (!Object.hasOwn(current, elementId)) return current;
      const next = { ...current };
      delete next[elementId];
      return next;
    });
    setMutationMessage("");
  };

  const onAction = async (elementId: string) => {
    if (!runtimePage || pendingElementId !== null) return;
    const binding = (runtimePage.bindings ?? []).find(
      (candidate: RelationshipBindingDto) =>
        candidate.status === "READY" &&
        candidate.source.objectId === elementId &&
        (candidate.bindingType === "CREATE" ||
          candidate.bindingType === "UPDATE" ||
          candidate.bindingType === "DELETE"),
    );
    if (!binding) return;
    const operation = binding.bindingType as BindingMutationOperation;
    const mappedInputIds = Array.isArray(binding.mapping.fields)
      ? binding.mapping.fields.flatMap((candidate) => {
          if (typeof candidate !== "object" || candidate === null) return [];
          const inputElementId = (candidate as { inputElementId?: unknown })
            .inputElementId;
          return typeof inputElementId === "string" ? [inputElementId] : [];
        })
      : [];
    const mutationValues = Object.fromEntries(
      mappedInputIds.map((inputElementId) => [
        inputElementId,
        formValues[inputElementId] ?? null,
      ]),
    );
    const retryKey =
      retryKeys.get(binding.id) ??
      `runtime-mutation:${binding.id}:${crypto.randomUUID()}`;
    retryKeys.set(binding.id, retryKey);
    setPendingElementId(elementId);
    setMutationMessage("");
    setFieldErrors({});
    try {
      const result = preview
        ? await executeDraftRuntimeMutation(
            sourceId,
            operation,
            binding.id,
            mutationValues,
            retryKey,
          )
        : await executePublishedRuntimeMutation(
            sourceId,
            operation,
            binding.id,
            mutationValues,
            retryKey,
          );
      if (
        result.snapshotId !== runtimePage.snapshotId ||
        result.definitionChecksum !== runtimePage.definitionChecksum
      ) {
        throw new Error("데이터 정의 불일치");
      }
      retryKeys.delete(binding.id);
      setMutationMessage(
        operation === "CREATE"
          ? "생성됨"
          : operation === "UPDATE"
            ? "수정됨"
            : "삭제됨",
      );
      if (result.refreshBindingIds.length > 0) {
        setReadRefreshRevision((current) => current + 1);
      }
    } catch (reason) {
      if (reason instanceof RuntimeApiError) {
        const details =
          typeof reason.details === "object" && reason.details !== null
            ? (reason.details as {
                readonly fieldErrors?: readonly {
                  readonly inputElementId?: unknown;
                  readonly message?: unknown;
                }[];
              })
            : null;
        const mapped = Object.fromEntries(
          (details?.fieldErrors ?? []).flatMap((field) =>
            typeof field.inputElementId === "string" &&
            typeof field.message === "string"
              ? [[field.inputElementId, field.message]]
              : [],
          ),
        );
        setFieldErrors(mapped);
        setMutationMessage(reason.message);
        if (reason.status < 500) retryKeys.delete(binding.id);
      } else {
        setMutationMessage(
          reason instanceof Error ? reason.message : "작업 실패",
        );
      }
    } finally {
      setPendingElementId(null);
    }
  };

  if (error)
    return (
      <main className="runtime-load-state" role="alert">
        <h1>런타임 오류</h1>
        <p>{error}</p>
      </main>
    );
  if (!navigation || !registry)
    return (
      <main className="runtime-load-state" role="status">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </main>
    );

  return (
    <RuntimeShell
      key={
        navigation.snapshotId ??
        ("versionId" in navigation ? navigation.versionId : sourceId)
      }
      navigation={navigation}
      activePage={activePage}
      runtimePage={runtimePage}
      runtimeElementData={runtimeElementData}
      runtimePageLoading={runtimePageLoading}
      runtimePageError={runtimePageError}
      definitionByType={
        new Map(
          registry.definitions.map((definition) => [
            definition.type,
            definition,
          ]),
        )
      }
      preview={preview}
      formValues={formValues}
      fieldErrors={fieldErrors}
      pendingElementId={pendingElementId}
      mutationMessage={mutationMessage}
      onValueChange={onValueChange}
      onAction={(elementId) => void onAction(elementId)}
      onNavigate={(page) => {
        const next = runtimePath(basePath, page.route);
        if (next !== location.pathname) navigate(next);
      }}
    />
  );
}

export function PublishedRuntime() {
  const params = useParams<{ projectId: string }>();
  return <RuntimeApplication projectId={params.projectId ?? ""} />;
}

export function DraftPreviewRuntime() {
  const params = useParams<{ projectId: string; previewId: string }>();
  return (
    <RuntimeApplication
      projectId={params.projectId ?? ""}
      previewId={params.previewId ?? ""}
    />
  );
}
