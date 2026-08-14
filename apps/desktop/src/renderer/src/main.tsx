import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TypographyProvider } from "./typography/TypographyProvider";
import "virtual:sanctuary-styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TypographyProvider>
      <App />
    </TypographyProvider>
  </StrictMode>
);

