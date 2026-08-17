import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles/globals.css";
import { applyTheme, getCachedTheme } from "./lib/theme";

// Aplicar el tema cacheado ANTES de montar React — evita un flash del tema
// oscuro por defecto mientras se espera la confirmacion async del backend
// (ver App.tsx, que reconcilia contra la preferencia guardada de verdad).
applyTheme(getCachedTheme());

// HashRouter avoids the need for server-side route handling inside the
// Tauri webview, which serves the app from a local asset root.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
