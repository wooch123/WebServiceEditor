import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Clock3, RotateCcw, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { listIcons, type IconCatalogItem } from "@/services/pages-api";
import {
  DynamicLucideIcon,
  rememberIconCatalogItem,
} from "./DynamicLucideIcon";

const GRID_COLUMNS = 6;
const RECENT_LIMIT = 12;
const RECENT_STORAGE_KEY = "webeditor:recent-page-icons";

function readRecentIcons(): IconCatalogItem[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? (value as IconCatalogItem[]) : [];
  } catch {
    return [];
  }
}

interface IconPickerProps {
  currentIcon: string;
  disabled?: boolean;
  onSelect: (icon: IconCatalogItem) => Promise<void> | void;
}

export function IconPicker({
  currentIcon,
  disabled = false,
  onSelect,
}: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [recentOnly, setRecentOnly] = useState(false);
  const [items, setItems] = useState<IconCatalogItem[]>([]);
  const [catalogCategories, setCatalogCategories] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [previewSize, setPreviewSize] = useState(24);
  const [recent, setRecent] = useState<IconCatalogItem[]>(readRecentIcons);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridId = useId();

  useEffect(() => {
    if (!open || recentOnly) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void listIcons({ query: query.trim(), category })
        .then((payload) => {
          if (controller.signal.aborted) return;
          setItems(payload.items);
          setCatalogCategories(payload.categories);
          setNextCursor(payload.nextCursor);
          setActiveIndex(0);
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) {
            setError(reason instanceof Error ? reason.message : "아이콘 오류");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 120);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [category, open, query, recentOnly]);

  const visibleItems = recentOnly ? recent : items;
  const activeDescendant = visibleItems[activeIndex]
    ? `${gridId}-${visibleItems[activeIndex].name}`
    : undefined;
  const categories = useMemo(
    () => [...new Set(catalogCategories)].sort((a, b) => a.localeCompare(b)),
    [catalogCategories],
  );
  const rowCount = Math.ceil(visibleItems.length / GRID_COLUMNS);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 66,
    overscan: 2,
    initialRect: { width: 420, height: 264 },
  });

  async function choose(icon: IconCatalogItem) {
    rememberIconCatalogItem(icon);
    await onSelect(icon);
    setRecent((current) => {
      const next = [
        icon,
        ...current.filter((candidate) => candidate.name !== icon.name),
      ].slice(0, RECENT_LIMIT);
      try {
        localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Selection remains usable when browser storage is unavailable.
      }
      return next;
    });
    setOpen(false);
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (visibleItems.length === 0) return;
    let next = activeIndex;
    if (event.key === "ArrowRight") next += 1;
    else if (event.key === "ArrowLeft") next -= 1;
    else if (event.key === "ArrowDown") next += GRID_COLUMNS;
    else if (event.key === "ArrowUp") next -= GRID_COLUMNS;
    else if (event.key === "Enter") {
      event.preventDefault();
      const icon = visibleItems[activeIndex];
      if (icon) void choose(icon);
      return;
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    } else return;
    event.preventDefault();
    next = Math.max(0, Math.min(visibleItems.length - 1, next));
    setActiveIndex(next);
    virtualizer.scrollToIndex(Math.floor(next / GRID_COLUMNS));
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoading(true);
    try {
      const payload = await listIcons({
        query: query.trim(),
        category,
        cursor: nextCursor,
      });
      setItems((current) => [...current, ...payload.items]);
      setNextCursor(payload.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "아이콘 오류");
    } finally {
      setLoading(false);
    }
  }

  const defaultIcon: IconCatalogItem = {
    name: "File",
    dynamicName: "file",
    categories: ["files"],
    keywords: ["page"],
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className="page-icon-trigger"
          variant="ghost"
          size="icon-sm"
          type="button"
          aria-label={`${currentIcon} 아이콘 변경`}
          disabled={disabled}
        >
          <DynamicLucideIcon iconName={currentIcon} />
        </Button>
      </DialogTrigger>
      <DialogContent className="icon-picker-dialog">
        <DialogHeader>
          <DialogTitle>아이콘</DialogTitle>
          <DialogDescription>검색 후 선택</DialogDescription>
        </DialogHeader>
        <div className="icon-picker-tools">
          <label className="icon-search-field">
            <Search aria-hidden="true" />
            <span className="sr-only">아이콘 검색</span>
            <Input
              value={query}
              placeholder="검색"
              aria-controls={gridId}
              aria-activedescendant={activeDescendant}
              onChange={(event) => {
                setQuery(event.target.value);
                setRecentOnly(false);
              }}
              onKeyDown={handleGridKeyDown}
              autoFocus
            />
          </label>
          <select
            className="icon-category-select"
            aria-label="아이콘 카테고리"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setRecentOnly(false);
            }}
          >
            <option value="">전체</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <Button
            variant={recentOnly ? "secondary" : "outline"}
            type="button"
            onClick={() => setRecentOnly((current) => !current)}
          >
            <Clock3 data-icon="inline-start" />
            최근
          </Button>
          <Button
            variant="outline"
            type="button"
            onClick={() => void choose(defaultIcon)}
          >
            <RotateCcw data-icon="inline-start" />
            기본
          </Button>
        </div>
        <label className="icon-preview-size">
          크기 <output>{previewSize}px</output>
          <input
            type="range"
            min="16"
            max="40"
            value={previewSize}
            onChange={(event) => setPreviewSize(Number(event.target.value))}
          />
        </label>
        {error && (
          <p className="icon-picker-error" role="alert">
            {error}
          </p>
        )}
        <div
          id={gridId}
          ref={scrollRef}
          className="icon-virtual-grid"
          role="grid"
          aria-label="Lucide 아이콘"
          aria-activedescendant={activeDescendant}
          tabIndex={0}
          onKeyDown={handleGridKeyDown}
        >
          {loading && items.length === 0 ? (
            <div className="icon-picker-loading" role="status">
              {Array.from({ length: 18 }, (_, index) => (
                <Skeleton key={index} className="size-12" />
              ))}
            </div>
          ) : (
            <div
              className="icon-virtual-grid-inner"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((row) => {
                const start = row.index * GRID_COLUMNS;
                return (
                  <div
                    className="icon-virtual-row"
                    key={row.key}
                    style={{ transform: `translateY(${row.start}px)` }}
                  >
                    {visibleItems
                      .slice(start, start + GRID_COLUMNS)
                      .map((icon, offset) => {
                        const index = start + offset;
                        return (
                          <button
                            id={`${gridId}-${icon.name}`}
                            key={icon.name}
                            className={cn(
                              "icon-choice",
                              index === activeIndex && "is-focused",
                            )}
                            type="button"
                            role="gridcell"
                            aria-label={icon.name}
                            aria-pressed={icon.name === currentIcon}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => void choose(icon)}
                          >
                            <DynamicLucideIcon
                              iconName={icon.name}
                              dynamicName={icon.dynamicName}
                              size={previewSize}
                            />
                            <span>{icon.name}</span>
                            {icon.name === currentIcon && (
                              <Check aria-hidden="true" />
                            )}
                          </button>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          )}
          {!loading && visibleItems.length === 0 && (
            <p className="icon-picker-empty">결과 없음</p>
          )}
        </div>
        <DialogFooter>
          {nextCursor && !recentOnly && (
            <Button
              variant="outline"
              type="button"
              onClick={() => void loadMore()}
              disabled={loading}
            >
              더 보기
            </Button>
          )}
          <Button
            variant="outline"
            type="button"
            onClick={() => setOpen(false)}
          >
            취소
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
