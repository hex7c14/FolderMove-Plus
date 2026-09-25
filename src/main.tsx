import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initTheme } from "./lib/useTheme";
import { initI18n } from "./i18n";

// 语言包内联在 bundle 里，initI18n 是同步的：
// 必须在首次 render 之前执行，避免先闪一下兜底语言
initI18n();
initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
