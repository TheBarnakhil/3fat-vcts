"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useState } from "react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(useGSAP, Flip, ScrollTrigger);
}

export const DURATION = {
  micro: 0.12,
  standard: 0.24,
  emphasized: 0.4,
} as const;

export const EASE = {
  out: "power2.out",
  inOut: "power2.inOut",
  expo: "expo.out",
} as const;

/**
 * Returns true when the OS reports `prefers-reduced-motion: reduce`.
 * Updates reactively if the user toggles the preference.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setReduced(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}

/**
 * Scoped GSAP wrapper that respects `prefers-reduced-motion`.
 * - In reduced-motion mode, ornament animations are skipped entirely (elements
 *   render in their final state). Functional transitions still run at 10ms.
 * - Cleanup is scoped to `containerRef` via `@gsap/react`'s `useGSAP`.
 */
export function useReducedMotionSafeGSAP(
  callback: (ctx: { gsap: typeof gsap; reduced: boolean }) => void,
  deps: unknown[] = [],
  containerRef?: React.RefObject<HTMLElement | null>,
) {
  const reduced = usePrefersReducedMotion();
  useGSAP(
    () => {
      callback({ gsap, reduced });
    },
    {
      scope: containerRef as React.RefObject<HTMLElement>,
      dependencies: [reduced, ...deps],
    },
  );
}

/* ---------- Preset timelines ---------- */

/**
 * Fade + slide-up entrance for a single element or NodeList.
 * Returns the created tween so callers can chain.
 */
export function fadeRise(
  target: gsap.TweenTarget,
  opts: { delay?: number; duration?: number; y?: number } = {},
) {
  const { delay = 0, duration = DURATION.standard, y = 12 } = opts;
  return gsap.fromTo(
    target,
    { opacity: 0, y },
    { opacity: 1, y: 0, duration, delay, ease: EASE.out, overwrite: "auto" },
  );
}

/**
 * Staggered entrance for a list of children, used for table rows,
 * dashboard KPI cards, sidebar nav items, etc.
 */
export function staggerChildren(
  target: gsap.TweenTarget,
  opts: { stagger?: number; duration?: number; y?: number } = {},
) {
  const { stagger = 0.04, duration = DURATION.standard, y = 10 } = opts;
  return gsap.fromTo(
    target,
    { opacity: 0, y },
    {
      opacity: 1,
      y: 0,
      duration,
      stagger,
      ease: EASE.out,
      overwrite: "auto",
    },
  );
}

/**
 * Shared-element transition helper. Capture state before the DOM change,
 * then call `play(state)` after it to animate FLIP-style.
 */
export const flipShared = {
  capture: (targets: gsap.DOMTarget) => Flip.getState(targets),
  play: (
    state: Flip.FlipState,
    opts: { duration?: number; ease?: string; absolute?: boolean } = {},
  ) =>
    Flip.from(state, {
      duration: opts.duration ?? DURATION.emphasized,
      ease: opts.ease ?? EASE.inOut,
      absolute: opts.absolute ?? false,
      nested: true,
    }),
};

/** Convenient timeline factory that pre-sets the VCTS defaults. */
export function vctsTimeline(opts: gsap.TimelineVars = {}) {
  return gsap.timeline({
    defaults: { duration: DURATION.standard, ease: EASE.out },
    ...opts,
  });
}

export { gsap, Flip, ScrollTrigger, useGSAP };
