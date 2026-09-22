import { useEffect, useRef, useState, type ReactNode } from "react"
import { useApp } from "../app-context"

interface DialogState {
  mode: "add" | "edit"
}

export function ProjectCombo(): ReactNode {
  const { state, selectProject, createSession } = useApp()
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const project = state.projects.find((p) => p.id === state.selectedProjectId)

  return (
    <div className="project-combo">
      <select
        className="project-select"
        value={state.selectedProjectId ?? ""}
        onChange={(e) => selectProject(e.target.value || undefined)}
        title={project?.path ?? "Select a project"}
        aria-label="Project"
      >
        <option value="">{state.projects.length ? "Select project…" : "No projects"}</option>
        {state.projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.available ? "" : "⚠ "}
            {p.name}
          </option>
        ))}
      </select>

      {project && !project.available ? (
        <span className="badge badge-bad" title="Path is missing or unavailable">
          unavailable
        </span>
      ) : null}

      <button
        className="icon-btn"
        title="New session"
        disabled={!project}
        onClick={() => void createSession()}
      >
        ＋
      </button>
      <button className="icon-btn" title="Add project" onClick={() => setDialog({ mode: "add" })}>
        ⊕
      </button>
      <button className="icon-btn" title="Edit project" disabled={!project} onClick={() => setDialog({ mode: "edit" })}>
        ✎
      </button>

      {dialog ? <ProjectDialog mode={dialog.mode} projectId={project?.id} onClose={() => setDialog(null)} /> : null}
    </div>
  )
}

function ProjectDialog({
  mode,
  projectId,
  onClose,
}: {
  mode: "add" | "edit"
  projectId?: string
  onClose: () => void
}): ReactNode {
  const { state, addProject, updateProject, removeProject } = useApp()
  const project = state.projects.find((p) => p.id === projectId)
  const [path, setPath] = useState(mode === "edit" ? (project?.path ?? "") : "")
  const [name, setName] = useState(mode === "edit" ? (project?.name ?? "") : "")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(state.projectsError)
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(undefined)
    if (mode === "add") {
      if (!path.trim()) {
        setError("A path is required")
        return
      }
      setBusy(true)
      await addProject({ path: path.trim(), name: name.trim() || undefined })
      setBusy(false)
      if (!state.projectsError) onClose()
      else setError(state.projectsError)
    } else if (projectId) {
      setBusy(true)
      await updateProject(projectId, { name: name.trim() || undefined })
      setBusy(false)
      if (!state.projectsError) onClose()
      else setError(state.projectsError)
    }
  }

  const remove = async () => {
    if (!projectId) return
    setBusy(true)
    await removeProject(projectId)
    setBusy(false)
    onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{mode === "add" ? "Add project" : "Edit project"}</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            ×
          </button>
        </div>
        <form className="modal-body" onSubmit={submit}>
          <label className="field">
            <span>Path {mode === "edit" ? "" : "(required)"}</span>
            <input
              ref={firstRef}
              className="input"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/absolute/path/to/folder"
              spellCheck={false}
              disabled={mode === "edit"}
            />
          </label>
          <label className="field">
            <span>Name (optional)</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
            />
          </label>
          {error ? <div className="error-text small">{error}</div> : null}

          {mode === "edit" && confirmDelete ? (
            <div className="confirm-row">
              <span className="muted small">Remove this project from the registry? Files are not deleted.</span>
              <div className="row gap">
                <button type="button" className="btn btn-danger btn-sm" onClick={() => void remove()} disabled={busy}>
                  Confirm delete
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <div className="modal-actions">
            {mode === "edit" ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => setConfirmDelete(true)}
                disabled={busy || confirmDelete}
              >
                Delete
              </button>
            ) : null}
            <span className="grow" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {busy ? "Saving…" : mode === "add" ? "Add" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
