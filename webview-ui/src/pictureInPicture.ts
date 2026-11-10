/**
 * pixel-agents-secure (local): a picture-in-picture button for the office in
 * a browser.
 *
 * Uses the Document Picture-in-Picture API (Chrome and Edge): the whole app is
 * moved into a small always-on-top window and moved back when that window
 * closes. Browsers without the API, and the VS Code webview, get no button.
 *
 * The buttons that use this live in ViewerBar.tsx.
 *
 * While the app lives in the picture-in-picture window, animation frames are
 * taken from THAT window: the opener tab is usually in the background, where
 * the browser stops delivering frames, and the office would freeze.
 *
 * Size changes have the same problem. A ResizeObserver belongs to the window
 * that created it, and the opener's observers are not served while its tab is
 * in the background: the canvas kept the size it had when it moved. So every
 * observer the app creates is a thin proxy (below) whose real observer is
 * re-created in whichever window currently holds the app.
 */

interface PipController {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

const PIP_WIDTH = 520;
const PIP_HEIGHT = 320;
/** Asks the app (useEditorActions) for a zoom that fits a box, or to restore
 *  the zoom it had before the first such request. Sizes in CSS pixels. */
const FIT_MARGIN = 0.92;
export const FIT_ZOOM_EVENT = 'pixel-agents:fit-zoom';
export type FitZoomDetail =
  | { restore: true }
  | { restore?: false; width: number; height: number; remember: boolean };

/** The app's root element. Looked up once: while the app floats, it is no
 *  longer in this document. */
let rootElement: HTMLElement | null = null;
function appRoot(): HTMLElement | null {
  rootElement ??= document.getElementById('root');
  return rootElement;
}

function requestZoom(detail: FitZoomDetail): void {
  window.dispatchEvent(new CustomEvent<FitZoomDetail>(FIT_ZOOM_EVENT, { detail }));
}

/** Fit the office to the space its canvas has, wherever the app lives now. */
export function fitOffice(remember = false): void {
  const rect = appRoot()?.querySelector('canvas')?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) {
    // A margin, so the office does not touch the window's edges.
    requestZoom({
      width: rect.width * FIT_MARGIN,
      height: rect.height * FIT_MARGIN,
      remember,
    });
  }
}

type ResizeObserverCtor = typeof ResizeObserver;

/** The window whose ResizeObserver serves the app right now. */
let observerHome: ResizeObserverCtor | null = null;
const liveObservers = new Set<RehomingResizeObserver>();

class RehomingResizeObserver implements ResizeObserver {
  private inner: ResizeObserver;
  private readonly targets = new Map<Element, ResizeObserverOptions | undefined>();
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    this.inner = this.make();
  }

  private make(): ResizeObserver {
    const Ctor = observerHome as ResizeObserverCtor;
    return new Ctor((entries) => this.callback(entries, this));
  }

  observe(target: Element, options?: ResizeObserverOptions): void {
    this.targets.set(target, options);
    liveObservers.add(this);
    this.inner.observe(target, options);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
    if (this.targets.size === 0) liveObservers.delete(this);
    this.inner.unobserve(target);
  }

  disconnect(): void {
    this.targets.clear();
    liveObservers.delete(this);
    this.inner.disconnect();
  }

  /** Observe the same targets from the current home window. A fresh observer
   *  reports every target once, which is the re-measure the move needs. */
  rehome(): void {
    this.inner.disconnect();
    this.inner = this.make();
    for (const [target, options] of this.targets) this.inner.observe(target, options);
  }
}

function moveObservers(home: ResizeObserverCtor): void {
  observerHome = home;
  for (const observer of [...liveObservers]) observer.rehome();
}

/**
 * Route the app's ResizeObservers through the proxy. Call BEFORE the app
 * renders, so no component holds a plain observer. A no-op where picture-in-
 * picture is unavailable.
 */
export function prepareResizeObservers(): void {
  if (observerHome !== null || !pipController() || typeof ResizeObserver !== 'function') return;
  observerHome = window.ResizeObserver;
  window.ResizeObserver = RehomingResizeObserver;
}

function pipController(): PipController | null {
  const candidate = (window as unknown as { documentPictureInPicture?: PipController })
    .documentPictureInPicture;
  return candidate && typeof candidate.requestWindow === 'function' ? candidate : null;
}

/** Copy the page's styles into the new window (same origin: links and inline rules). */
function copyStyles(target: Document): void {
  for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
    target.head.appendChild(node.cloneNode(true));
  }
  target.documentElement.className = document.documentElement.className;
  target.body.className = document.body.className;
  target.body.style.margin = '0';
  target.body.style.overflow = 'hidden';
  target.documentElement.style.colorScheme = 'dark';
}

/** Move the app into a floating window; `onClose` runs when it comes back. */
export async function openPictureInPicture(onClose: () => void): Promise<void> {
  const controller = pipController();
  const root = appRoot();
  const home = root?.parentElement;
  if (!controller || !root || !home) {
    onClose();
    return;
  }
  const pip = await controller.requestWindow({ width: PIP_WIDTH, height: PIP_HEIGHT });
  copyStyles(pip.document);
  pip.document.title = document.title;

  const placeholder = document.createElement('div');
  placeholder.textContent = 'O escritório está na janela flutuante. Feche-a para voltar.';
  placeholder.style.cssText = 'padding:24px;color:var(--pixel-text, inherit);font-size:16px';
  home.insertBefore(placeholder, root);
  pip.document.body.appendChild(root);

  const openerRaf = window.requestAnimationFrame;
  const openerCancel = window.cancelAnimationFrame;
  window.requestAnimationFrame = (callback) => pip.requestAnimationFrame(callback);
  window.cancelAnimationFrame = (handle) => pip.cancelAnimationFrame(handle);
  // The frame already pending on the opener fires while this tab is still
  // visible (the click happened in it); every frame after that is asked of
  // the new window. The resize lets the canvas measure its new home.
  const pipObserver = (pip as unknown as { ResizeObserver?: ResizeObserverCtor }).ResizeObserver;
  const openerObserver = observerHome;
  if (openerObserver && pipObserver) moveObservers(pipObserver);
  // Code that listens for the opener's `resize` hears the new window's too.
  pip.addEventListener('resize', () => {
    window.dispatchEvent(new Event('resize'));
    fitOffice(true);
  });
  window.dispatchEvent(new Event('resize'));
  fitOffice(true);
  // The copied stylesheets load after this point, and the layout only settles
  // then: fit again once each has arrived.
  for (const link of pip.document.querySelectorAll('link[rel="stylesheet"]')) {
    link.addEventListener('load', () => fitOffice(true), { once: true });
  }
  pip.setTimeout(() => fitOffice(true), 500);

  pip.addEventListener(
    'pagehide',
    () => {
      window.requestAnimationFrame = openerRaf;
      window.cancelAnimationFrame = openerCancel;
      home.insertBefore(root, placeholder);
      placeholder.remove();
      if (openerObserver) moveObservers(openerObserver);
      requestZoom({ restore: true });
      onClose();
      window.dispatchEvent(new Event('resize'));
    },
    { once: true },
  );
}

export function canPictureInPicture(): boolean {
  return pipController() !== null;
}
