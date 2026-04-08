import React from 'react';
import { createRoot } from 'react-dom/client';
import '@assets/styles/globals.css';
import '@pages/popup/index.css';
import Popup from '@pages/popup/Popup';
import * as rpc from '@utils/chromeRPC';

function init() {
  const rootContainer = document.querySelector("#__root");
  if (!rootContainer) throw new Error("Can't find Popup root element");
  document.documentElement.classList.add("popup-mode");
  document.body.classList.add("popup-mode");
  rootContainer.classList.add("popup-mode");
  void rpc.notifyPopupOpened().catch(() => {
    // no-op
  });
  const root = createRoot(rootContainer);
  root.render(<Popup />);
}

init();
