import { useState, useCallback, useMemo } from "react";
import {
  createT,
  getStoredLang,
  setStoredLang,
  type SupportedLang,
  type TFunction,
} from "../lib/i18n";

export function useLang() {
  const [lang, setLangState] = useState<SupportedLang>(getStoredLang);

  const setLang = useCallback((l: SupportedLang) => {
    setLangState(l);
    setStoredLang(l);
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === "it" ? "en" : "it");
  }, [lang, setLang]);

  const t: TFunction = useMemo(() => createT(lang), [lang]);

  return { lang, setLang, toggleLang, t };
}
