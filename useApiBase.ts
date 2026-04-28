import { useApp } from "@/context/AppContext";

const DEFAULT_DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";

export function useApiBase(): string {
  const { settings } = useApp();
  const custom = settings.customServerUrl?.trim();
  if (custom) {
    const url = custom.replace(/\/$/, "");
    return url.startsWith("http") ? url : `http://${url}`;
  }
  return DEFAULT_DOMAIN ? `https://${DEFAULT_DOMAIN}` : "";
}

export function getDefaultDomain(): string {
  return DEFAULT_DOMAIN;
}
