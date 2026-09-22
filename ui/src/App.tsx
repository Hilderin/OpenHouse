import type { ReactNode } from "react"
import { useApp } from "./app-context"
import { ProjectCombo } from "./components/ProjectCombo"
import { SessionRows } from "./components/SessionRows"
import { ChatView } from "./components/ChatView"
import { StatusBar } from "./components/StatusBar"
import { DrawerPanel, RightToolbar } from "./components/RightDrawer"

export function App(): ReactNode {
  const { state } = useApp()

  return (
    <div className="app">
      <div className="app-body">
        <aside className="sidebar">
          <ProjectCombo />
          <SessionRows />
        </aside>

        <main className="app-main">
          <ChatView />
        </main>

        <div className="app-right">
          <DrawerPanel />
          <RightToolbar />
        </div>
      </div>

      <StatusBar />
      {state.healthError ? <div className="global-error">Core unreachable: {state.healthError}</div> : null}
    </div>
  )
}
