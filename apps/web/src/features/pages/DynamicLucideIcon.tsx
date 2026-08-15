import { FileQuestion } from "lucide-react";
import type { LucideIcon, LucideProps } from "lucide-react";
import { useEffect, useState } from "react";

import { getIcon, type IconCatalogItem } from "@/services/pages-api";

type DynamicIconImports =
  (typeof import("lucide-react/dynamicIconImports"))["default"];

const iconCache = new Map<string, Promise<LucideIcon | null>>();
const catalogNameCache = new Map<string, string>();
const catalogRequestCache = new Map<string, Promise<string | null>>();
let dynamicIconImportsPromise: Promise<DynamicIconImports> | null = null;

export function rememberIconCatalogItem(item: IconCatalogItem) {
  catalogNameCache.set(item.name, item.dynamicName);
}

function resolveCatalogDynamicName(iconName: string) {
  const cached = catalogNameCache.get(iconName);
  if (cached) return Promise.resolve(cached);
  const pending = catalogRequestCache.get(iconName);
  if (pending) return pending;
  const request = getIcon(iconName)
    .then(({ item }) => {
      rememberIconCatalogItem(item);
      return item.dynamicName;
    })
    .catch(() => null);
  catalogRequestCache.set(iconName, request);
  return request;
}

export function iconNameToDynamicName(iconName: string): string {
  return iconName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([A-Za-z])([0-9])/g, "$1-$2")
    .toLowerCase();
}

function loadIcon(dynamicName: string): Promise<LucideIcon | null> {
  const cached = iconCache.get(dynamicName);
  if (cached) return cached;
  dynamicIconImportsPromise ??= import("lucide-react/dynamicIconImports").then(
    (module) => module.default,
  );
  const request = dynamicIconImportsPromise
    .then((imports) => {
      const importer = imports[dynamicName as keyof DynamicIconImports] as
        (() => Promise<{ default: LucideIcon }>) | undefined;
      return importer ? importer().then((module) => module.default) : null;
    })
    .catch(() => null);
  iconCache.set(dynamicName, request);
  return request;
}

export function DynamicLucideIcon({
  iconName,
  dynamicName,
  ...props
}: LucideProps & { iconName: string; dynamicName?: string }) {
  const [resolvedName, setResolvedName] = useState<string | null | undefined>(
    dynamicName ?? catalogNameCache.get(iconName),
  );
  const [Icon, setIcon] = useState<LucideIcon | null | undefined>(undefined);

  useEffect(() => {
    if (dynamicName) {
      catalogNameCache.set(iconName, dynamicName);
      setResolvedName(dynamicName);
      return;
    }
    const cached = catalogNameCache.get(iconName);
    if (cached) {
      setResolvedName(cached);
      return;
    }
    setResolvedName(undefined);
    let active = true;
    void resolveCatalogDynamicName(iconName).then((value) => {
      if (active) setResolvedName(value);
    });
    return () => {
      active = false;
    };
  }, [dynamicName, iconName]);

  useEffect(() => {
    if (!resolvedName) {
      setIcon(resolvedName === null ? null : undefined);
      return;
    }
    setIcon(undefined);
    let active = true;
    void loadIcon(resolvedName).then((component) => {
      if (active) setIcon(() => component);
    });
    return () => {
      active = false;
    };
  }, [resolvedName]);

  if (resolvedName === undefined || Icon === undefined) {
    return <span className="dynamic-icon-placeholder" aria-hidden="true" />;
  }
  if (!Icon) {
    return (
      <span
        className="dynamic-icon-fallback"
        title={`아이콘 오류: ${iconName}`}
      >
        <FileQuestion aria-hidden="true" {...props} />
        <span className="sr-only">아이콘 오류</span>
      </span>
    );
  }

  return <Icon aria-hidden="true" {...props} />;
}
