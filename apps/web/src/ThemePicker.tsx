import { Check, Palette, Search, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  defaultTheme,
  themes,
  type ThemeGroup,
  type WebEditorTheme,
} from "@/theme";

const themeGroups: ReadonlyArray<{
  readonly id: ThemeGroup;
  readonly label: string;
}> = [
  { id: "dark", label: "다크" },
  { id: "gray", label: "그레이" },
  { id: "light", label: "라이트" },
];

function ThemeThumbnail({ theme }: { theme: WebEditorTheme }) {
  return (
    <span
      className="theme-thumbnail"
      style={{
        backgroundColor: theme.tokens.background,
        borderColor: theme.tokens.border,
      }}
      aria-hidden="true"
    >
      <span style={{ backgroundColor: theme.tokens.primary }} />
      <span style={{ backgroundColor: theme.tokens.chart2 }} />
      <span style={{ backgroundColor: theme.tokens.chart5 }} />
    </span>
  );
}

export function ThemePicker({
  themeId,
  onThemeChange,
}: {
  readonly themeId: string;
  readonly onThemeChange: (themeId: string) => void;
}) {
  const currentTheme =
    themes.find((theme) => theme.id === themeId) ?? defaultTheme;
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<ThemeGroup>(currentTheme.group);
  const [query, setQuery] = useState("");
  const [openingThemeId, setOpeningThemeId] = useState(currentTheme.id);

  const visibleThemes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko");
    return themes.filter(
      (theme) =>
        theme.group === group &&
        (!normalizedQuery ||
          `${theme.name} ${theme.id} ${theme.referenceFamily}`
            .toLocaleLowerCase("ko")
            .includes(normalizedQuery)),
    );
  }, [group, query]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setOpeningThemeId(currentTheme.id);
      setGroup(currentTheme.group);
      setQuery("");
    }
    setOpen(nextOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          className="theme-control"
          variant="outline"
          size="sm"
          type="button"
          aria-label={`테마 선택, 현재 ${currentTheme.name}`}
        >
          <Palette aria-hidden="true" />
          <span className="theme-control-label">테마</span>
          <span
            className="theme-control-swatch"
            style={{ backgroundColor: currentTheme.tokens.primary }}
            aria-hidden="true"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        className="theme-picker"
        aria-label="테마 선택기"
      >
        <PopoverHeader className="theme-picker-header">
          <PopoverTitle>테마</PopoverTitle>
        </PopoverHeader>

        <Tabs
          value={group}
          onValueChange={(value) => setGroup(value as ThemeGroup)}
        >
          <TabsList className="theme-picker-tabs" aria-label="테마 분류">
            {themeGroups.map((item) => (
              <TabsTrigger key={item.id} value={item.id}>
                {item.label}
                <span>
                  {themes.filter((theme) => theme.group === item.id).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <label className="theme-picker-search">
          <Search aria-hidden="true" />
          <span className="sr-only">테마 검색</span>
          <Input
            type="search"
            value={query}
            placeholder="테마 검색"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <ScrollArea className="theme-picker-scroll">
          <div
            className="theme-picker-grid"
            role="listbox"
            aria-label={`${themeGroups.find((item) => item.id === group)?.label} 테마`}
          >
            {visibleThemes.map((theme) => {
              const selected = theme.id === currentTheme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  className={`theme-option ${selected ? "is-selected" : ""}`}
                  role="option"
                  data-theme-id={theme.id}
                  aria-selected={selected}
                  aria-label={`${theme.name} 테마 적용`}
                  onClick={() => onThemeChange(theme.id)}
                >
                  <ThemeThumbnail theme={theme} />
                  <span className="theme-option-copy">
                    <strong>{theme.name}</strong>
                    <small>{theme.referenceFamily}</small>
                  </span>
                  {selected && <Check aria-hidden="true" />}
                </button>
              );
            })}
            {visibleThemes.length === 0 && (
              <div className="theme-picker-empty">
                <Search aria-hidden="true" />
                <span>결과 없음</span>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="theme-picker-actions">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={openingThemeId === currentTheme.id}
            onClick={() => onThemeChange(openingThemeId)}
          >
            <Undo2 aria-hidden="true" />
            되돌리기
          </Button>
          <Button size="sm" type="button" onClick={() => setOpen(false)}>
            적용
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
