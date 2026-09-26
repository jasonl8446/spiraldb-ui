import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { UNSAVED_CLOSE_MESSAGE } from '../lib/quest-edit';

/**
 * `useUnsavedChangesGuard(dirty)` — the unsaved-changes guard (plan task 3.10's
 * "Dirty-state guard: navigation/close with unsaved changes → confirm dialog").
 *
 * Two exits are intercepted, and only while the document is actually dirty:
 *
 * 1. **In-app navigation.** A capture-phase `click` listener on `document` sees an anchor click
 *    before React Router's `<Link>` handler does (React 18 listens on the root container, which is
 *    below `document`), and when the click would leave the current location it stops the event and
 *    opens the caller's confirm dialog instead. Because the interception is by *target* rather
 *    than by component, every in-app link is covered — the page's own back link, the sidebar, the
 *    browse table's rows — with no per-link wiring and no change to the layout shell. Modified
 *    clicks (ctrl/cmd/shift/alt), middle clicks, `download`, `target` other than `_self`, `rel`
 *    carrying `external`, cross-origin URLs and same-location anchors are deliberately **not**
 *    intercepted: those are either a new tab (no unsaved work is lost here) or not the app's
 *    navigation at all.
 * 2. **Window close / reload.** `beforeunload` is registered only while dirty, calls
 *    `preventDefault()` and sets `returnValue`, which is the only contract a browser honours; the
 *    copy in {@link UNSAVED_CLOSE_MESSAGE} is for engines that show it.
 *
 * **An honest limit, recorded rather than papered over:** the browser's own Back/Forward buttons
 * are not intercepted. React Router v6's `useBlocker`/`usePrompt` require a **data router**
 * (`createBrowserRouter`), and this app uses a plain `<BrowserRouter>`; a `popstate` hack that
 * re-pushes the current entry would desynchronise the router's location from the URL for every
 * route in the app. Closing that gap means migrating the app shell's router, which is a shell
 * decision, not an edit-mode one (reported to the story lead).
 *
 * The hook owns no pixels: it reports `blocked` and hands the caller `discard` (leave — the edits
 * are abandoned with the unmount) and `stay`. A **Discard** control that keeps the user on the
 * page lives in the header and calls `useQuestDocument`'s `reset` directly, which is the other
 * half of the AC's "discarding restores the loaded document exactly".
 */
export interface UnsavedChangesGuard {
  /** `true` while a blocked navigation is waiting for the user's answer. */
  blocked: boolean;
  /** Leaves for the blocked destination (the dialog's destructive action). */
  discard: () => void;
  /** Cancels the blocked navigation and stays (the dialog's safe action, and its close). */
  stay: () => void;
}

/**
 * The internal path an anchor click would navigate to, or `null` when the click must proceed
 * untouched. Pure DOM logic, kept out of the effects so both listeners share one definition.
 */
function blockedNavigationTarget(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0) {
    return null;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return null;
  }
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }
  const anchor = target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) {
    return null;
  }
  if (anchor.hasAttribute('download')) {
    return null;
  }
  if (anchor.target !== '' && anchor.target !== '_self') {
    return null;
  }
  const rel = anchor.getAttribute('rel');
  if (rel !== null && rel.split(/\s+/).includes('external')) {
    return null;
  }
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) {
    return null;
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return next === current ? null : next;
}

export function useUnsavedChangesGuard(dirty: boolean): UnsavedChangesGuard {
  const navigate = useNavigate();
  const [blocked, setBlocked] = useState(false);
  /**
   * The destination, held outside state: it is read once by `discard` and must not re-render the
   * page, and a `useState` updater that called `navigate` would run twice under StrictMode.
   */
  const pendingRef = useRef<string | null>(null);
  /** The listener is registered once; it reads the current flag through this ref. */
  const dirtyRef = useRef(dirty);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    function onBeforeUnload(event: BeforeUnloadEvent): void {
      event.preventDefault();
      event.returnValue = UNSAVED_CLOSE_MESSAGE;
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);

  useEffect(() => {
    function onClick(event: MouseEvent): void {
      if (!dirtyRef.current) {
        return;
      }
      const path = blockedNavigationTarget(event);
      if (path === null) {
        return;
      }
      // The link must not navigate *and* React Router must not see the click: a
      // `preventDefault()` alone would only stop the browser's default while `<Link>`'s own
      // handler still called `navigate()`.
      event.preventDefault();
      event.stopPropagation();
      pendingRef.current = path;
      setBlocked(true);
    }
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  const discard = useCallback((): void => {
    const path = pendingRef.current;
    pendingRef.current = null;
    setBlocked(false);
    if (path !== null) {
      navigate(path);
    }
  }, [navigate]);

  const stay = useCallback((): void => {
    pendingRef.current = null;
    setBlocked(false);
  }, []);

  return { blocked, discard, stay };
}
