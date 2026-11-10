/**
 * pixel-agents-secure (local): a picture-in-picture button for the office in
 * a browser.
 *
 * Uses the Document Picture-in-Picture API (Chrome and Edge): the whole app is
 * moved into a small always-on-top window and moved back when that window
 * closes. Browsers without the API, and the VS Code webview, get no button.
 *
 * Kept out of React on purpose: one DOM button and one import in main.tsx, so
 * upstream changes to the app's components never conflict with it.
 *
 * While the app lives in the picture-in-picture window, animation frames are
 * taken from THAT window: the opener tab is usually in the background, where
 * the browser stops delivering frames, and the office would freeze.
 */

interface PipController {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

const PIP_WIDTH = 520;
const PIP_HEIGHT = 320;
const BUTTON_ID = 'pixel-agents-pip-button';

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
}

async function openPictureInPicture(controller: PipController, root: HTMLElement): Promise<void> {
  const home = root.parentElement;
  if (!home) return;
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
  window.dispatchEvent(new Event('resize'));

  pip.addEventListener(
    'pagehide',
    () => {
      window.requestAnimationFrame = openerRaf;
      window.cancelAnimationFrame = openerCancel;
      home.insertBefore(root, placeholder);
      placeholder.remove();
      window.dispatchEvent(new Event('resize'));
    },
    { once: true },
  );
}

/** Add the button, when this browser can do it. Safe to call more than once. */
export function installPictureInPictureButton(): void {
  const controller = pipController();
  const root = document.getElementById('root');
  if (!controller || !root || document.getElementById(BUTTON_ID)) return;

  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.textContent = 'PiP';
  button.title = 'Abrir o escritório numa janela flutuante, sempre por cima';
  button.style.cssText = [
    'position:fixed',
    'top:8px',
    'right:8px',
    'z-index:2147483000',
    'padding:4px 10px',
    'font:inherit',
    'cursor:pointer',
    'color:var(--pixel-text, inherit)',
    'background:var(--pixel-bg, transparent)',
    'border:2px solid var(--pixel-border, currentColor)',
    'box-shadow:var(--pixel-shadow, none)',
    'border-radius:0',
  ].join(';');
  button.addEventListener('click', () => {
    void openPictureInPicture(controller, root).catch((err: unknown) => {
      console.error('[Pixel Agents] picture-in-picture failed:', err);
    });
  });
  // On the page, not inside #root: it must stay behind when the app moves out.
  document.body.appendChild(button);
}
