import React from "react";
import ReactDOM from "react-dom/client";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { RouterProvider, createBrowserRouter } from "react-router-dom";

import "@/index.css";
import { createAppRouter } from "@/app/router";
import { loadRuntimeConfig } from "@/lib/runtimeConfig";

async function bootstrap() {
  try {
    await loadRuntimeConfig();
  } catch (err) {
    console.warn("Runtime config load failed, using defaults:", err);
  }

  const router = createBrowserRouter(createAppRouter());
  const root = ReactDOM.createRoot(document.getElementById("root"));

  root.render(
    <React.StrictMode>
      <HotkeysProvider
        defaultOptions={{
          hotkey: { preventDefault: true },
          hotkeySequence: { timeout: 1200 },
        }}
      >
        <RouterProvider router={router} />
      </HotkeysProvider>
    </React.StrictMode>,
  );
}

bootstrap();
