import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { AppProvider } from "./app-context"
import { App } from "./App"
import "./styles.css"

const container = document.getElementById("root")
if (!container) throw new Error("root element not found")

createRoot(container).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
)
