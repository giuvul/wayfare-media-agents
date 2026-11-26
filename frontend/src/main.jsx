import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/figtree"; // titoli (grottesco, come il logotipo)
import "@fontsource-variable/inter"; // interfaccia e testi
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
