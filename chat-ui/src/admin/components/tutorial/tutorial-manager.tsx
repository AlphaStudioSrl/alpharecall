/**
 * tutorial-manager.tsx
 * Auto-starts the per-section guided tour the first time a tenant opens an
 * admin section (after onboarding). Completing OR skipping a tour marks the
 * section as seen (persisted via tutorial_sections), so it never re-fires
 * unless the tenant replays it from Settings > Advanced.
 */

import { useCallback, useEffect, useRef } from "react";
import { useApp } from "@/admin/app-context";
import { interpolate } from "@/admin/lib/i18n";
import { assistantName } from "@/admin/components/assistant/shared";
import { useTour, isElementVisible } from "./use-tour";
import { SECTION_TOURS, type TourSection } from "./tour-steps";

/** Delay before the first DOM probe, letting the page animate in. */
const INITIAL_DELAY_MS = 450;
/** Poll for async-rendered anchors: 16 × 250ms ≈ 4s budget. */
const POLL_INTERVAL_MS = 250;
const MAX_POLL_ATTEMPTS = 16;

/** `tour` is the open leaf's tour (lib/nav.ts NavLeaf.tour), if it has one. */
export function TutorialManager({ tour }: { tour?: TourSection }) {
  const {
    t,
    settings,
    theme,
    isAdmin,
    onboardingCompleted,
    tutorialSections,
    markTutorialSectionSeen,
  } = useApp();

  // The steps say "{name}": the assistant's own name, not "il chatbot".
  // A ref, so a rename (or a settings refetch) does not restart useTour and
  // close a tour that is open.
  const nameRef = useRef("");
  nameRef.current = assistantName(settings, t("assistant.common.fallbackName"));
  const tourT = useCallback((key: string) => interpolate(t(key), { name: nameRef.current }), [t]);

  const { startTour, exitTour } = useTour({
    t: tourT,
    theme,
    onComplete: markTutorialSectionSeen,
    onSkip: markTutorialSectionSeen,
  });

  // Sections already attempted this session — avoids re-probing a page whose
  // anchors never appeared (e.g. plan-locked) on every render. A fresh page
  // load retries, so the tour still runs once the section becomes usable.
  const attemptedRef = useRef<Set<string>>(new Set());

  // A replay reset (sections wiped) must also clear the session guard so the
  // current section's tour can restart immediately. Declared before the main
  // effect so it runs first on the same render pass.
  const prevSectionsRef = useRef(tutorialSections);
  useEffect(() => {
    if (prevSectionsRef.current.length > 0 && tutorialSections.length === 0) {
      attemptedRef.current.clear();
    }
    prevSectionsRef.current = tutorialSections;
  }, [tutorialSections]);

  useEffect(() => {
    if (!isAdmin || !onboardingCompleted) return;
    if (!tour) return;
    const section = tour;
    if (tutorialSections.includes(section)) return;
    if (attemptedRef.current.has(section)) return;

    const selectors = (SECTION_TOURS[section] || []).map((s) => s.selector);
    if (selectors.length === 0) return;

    let cancelled = false;
    let attempts = 0;
    let timer: number;

    const tryStart = () => {
      if (cancelled) return;
      const anchorPresent = selectors.some((sel) => {
        try {
          return isElementVisible(document.querySelector(sel));
        } catch {
          return false;
        }
      });
      if (anchorPresent) {
        attemptedRef.current.add(section);
        startTour(section);
        return;
      }
      attempts += 1;
      if (attempts < MAX_POLL_ATTEMPTS) {
        timer = window.setTimeout(tryStart, POLL_INTERVAL_MS);
      } else {
        // Give up for this session without marking the section seen — the
        // tour will retry on the next page load.
        attemptedRef.current.add(section);
      }
    };

    timer = window.setTimeout(tryStart, INITIAL_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      // Navigating away tears down a tour pointing at unmounted elements.
      exitTour();
    };
  }, [
    tour,
    isAdmin,
    onboardingCompleted,
    tutorialSections,
    startTour,
    exitTour,
  ]);

  return null;
}
