import { useState } from "react";

const NEAR_VIEWPORT_ROOT_MARGIN = "800px";

const callbacks = new WeakMap<Element, () => void>();
// One observer per scroll container; null key is the browser viewport.
const observers = new WeakMap<Element, IntersectionObserver>();
let viewportObserver: IntersectionObserver | null = null;

function scrollParent(element: HTMLElement): Element | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return node;
  }
  return null;
}

function createObserver(root: Element | null): IntersectionObserver {
  return new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) callbacks.get(entry.target)?.();
      }
    },
    { root, rootMargin: NEAR_VIEWPORT_ROOT_MARGIN },
  );
}

function observerFor(root: Element | null): IntersectionObserver {
  if (root === null) return (viewportObserver ??= createObserver(null));
  let existing = observers.get(root);
  if (existing === undefined) {
    existing = createObserver(root);
    observers.set(root, existing);
  }
  return existing;
}

/**
 * Latches true once the element has come within a generous margin of the
 * viewport. When disabled it is always near, so normal rendering is unchanged.
 */
export function useNearViewport(enabled: boolean) {
  const [reached, setReached] = useState(false);
  const near = !enabled || reached || typeof IntersectionObserver === "undefined";
  const ref = (element: HTMLElement | null) => {
    if (element === null || near) return;
    const shared = observerFor(scrollParent(element));
    callbacks.set(element, () => {
      setReached(true);
      shared.unobserve(element);
      callbacks.delete(element);
    });
    shared.observe(element);
    return () => {
      shared.unobserve(element);
      callbacks.delete(element);
    };
  };
  return { ref, near };
}
