import ReactDOM from "react-dom/client";
import { LocaleProvider } from "@douyinfe/semi-ui";
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import App from "./App.jsx";
import en_US from "@douyinfe/semi-ui/lib/es/locale/source/en_US";
import "bootstrap-icons/font/bootstrap-icons.css";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./index.css";
import "./i18n/i18n.js";

// Use the locally bundled monaco-editor instead of fetching it from a CDN
// at runtime. Must run before any <Editor>/<DiffEditor> mounts.
loader.config({ monaco });

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <LocaleProvider locale={en_US}>
    <App />
  </LocaleProvider>,
);
