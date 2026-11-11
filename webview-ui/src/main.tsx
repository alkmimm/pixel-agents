import './index.css';
// Bundled by Vite into the SPA's own CSS — the standalone server must serve
// every asset itself (no CDN).
import '@xterm/xterm/css/xterm.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';
import { prepareResizeObservers } from './pictureInPicture';
import { isBrowserRuntime } from './runtime';
import { startActivityFeed } from './viewer/agentActivity';
import { startSignalsFeed } from './viewer/agentSignals';

async function main() {
  // browserMock is for Vite dev mode only (UI prototyping without a server).
  // In standalone server mode, assets are loaded server-side and sent over WebSocket.
  if (isBrowserRuntime && import.meta.env.DEV) {
    const { initBrowserMock } = await import('./browserMock.js');
    await initBrowserMock();
  }
  // pixel-agents-secure (local): before the first render, see pictureInPicture.ts.
  if (isBrowserRuntime) prepareResizeObservers();
  // Listening before the first message, so the history sent on connect is
  // kept. In the VS Code panel too: the list of agents and the labels "quando
  // importa" read the same feeds there.
  startActivityFeed();
  startSignalsFeed();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

main().catch(console.error);
