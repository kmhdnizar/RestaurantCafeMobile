import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type Locale = "en" | "ms";

const STORAGE_KEY = "locale";

interface LocaleState {
  locale: Locale;
  hydrate: () => Promise<void>;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: "en",

  async hydrate() {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === "ms" || stored === "en") set({ locale: stored });
  },

  setLocale(locale) {
    set({ locale });
    void AsyncStorage.setItem(STORAGE_KEY, locale);
  },
}));
