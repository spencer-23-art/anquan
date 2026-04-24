import { create } from "zustand";
import { persist } from "zustand/middleware";

const getSystemTheme = () =>
  window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const applyTheme = (mode) => {
  const resolved = mode === "system" ? getSystemTheme() : mode;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
};

export const useThemeStore = create(
  persist(
    (set, get) => ({
      mode: "light",
      setMode: (mode) => {
        set({ mode });
        applyTheme(mode);
      },
      apply: () => applyTheme(get().mode),
    }),
    {
      name: "theme-storage",
      onRehydrateStorage: () => (state) => {
        applyTheme(state?.mode || "light");
      },
    }
  )
);

export function initializeTheme() {
  useThemeStore.getState().apply();

  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (useThemeStore.getState().mode === "system") {
      applyTheme("system");
    }
  });
}

