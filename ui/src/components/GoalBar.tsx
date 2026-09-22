import { useState, type ReactNode } from "react"
import { useApp } from "../app-context"
import { Badge } from "./common"
import { formatNumber, relativeTime } from "../format"

export function GoalBar(): ReactNode {
  const { state, setGoal, pauseGoal, resumeGoal, clearGoal } = useApp()
  const { chat } = state
  const [open, setOpen] = useState(false)
  const [objective, setObjective] = useState("")
  const [budget, setBudget] = useState("")
  const [maxTurns, setMaxTurns] = useState("")
  const [busy, setBusy] = useState(false)

  if (!chat.sessionId) return null
  const goal = chat.goal

  const arm = async () => {
    if (!objective.trim()) return
    setBusy(true)
    await setGoal({
      objective: objective.trim(),
      budgetTokens: budget ? Number(budget) : undefined,
      maxTurns: maxTurns ? Number(maxTurns) : undefined,
    })
    setBusy(false)
    setOpen(false)
    setObjective("")
    setBudget("")
    setMaxTurns("")
  }

  return (
    <div className="goal-bar">
      <div className="goal-bar-line">
        <span className="goal-label">Goal</span>
        {goal ? (
          <>
            <Badge
              tone={
                goal.state === "complete"
                  ? "good"
                  : goal.state === "blocked" || goal.state === "aborted"
                    ? "bad"
                    : goal.state === "paused"
                      ? "warn"
                      : "info"
              }
            >
              {goal.state}
            </Badge>
            <span className="goal-objective ellipsis" title={goal.objective}>
              {goal.objective}
            </span>
            <span className="muted small">
              turns {goal.turns}
              {goal.maxTurns ? `/${goal.maxTurns}` : ""}
            </span>
            <span className="muted small">
              {formatNumber(goal.usedTokens)}
              {goal.budgetTokens ? ` / ${formatNumber(goal.budgetTokens)}` : ""} tok
            </span>
            {goal.lastVerdict ? <Badge tone="info">{goal.lastVerdict}</Badge> : null}

            {goal.state === "running" || goal.state === "armed" ? (
              <button className="btn btn-ghost btn-xs" onClick={() => void pauseGoal()}>
                Pause
              </button>
            ) : null}
            {goal.state === "paused" ? (
              <button className="btn btn-ghost btn-xs" onClick={() => void resumeGoal()}>
                Resume
              </button>
            ) : null}
            <button className="btn btn-ghost btn-xs danger" onClick={() => void clearGoal()}>
              Clear
            </button>
            <button className="btn btn-ghost btn-xs" onClick={() => setOpen((v) => !v)}>
              {open ? "Cancel" : "Re-arm"}
            </button>
          </>
        ) : (
          <button className="btn btn-ghost btn-xs" onClick={() => setOpen((v) => !v)}>
            {open ? "Cancel" : "Arm goal"}
          </button>
        )}
      </div>

      {goal?.note ? <div className="muted small goal-note">{goal.note}</div> : null}
      {goal ? <div className="muted small">updated {relativeTime(goal.updatedAt)}</div> : null}

      {open ? (
        <div className="goal-form">
          <textarea
            className="textarea"
            rows={2}
            placeholder="Objective"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />
          <div className="form-row">
            <label className="field">
              <span>Budget tokens</span>
              <input className="input" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </label>
            <label className="field">
              <span>Max turns</span>
              <input className="input" inputMode="numeric" value={maxTurns} onChange={(e) => setMaxTurns(e.target.value)} />
            </label>
            <div className="field goal-arm">
              <span>&nbsp;</span>
              <button className="btn btn-primary btn-sm" onClick={() => void arm()} disabled={busy || !objective.trim()}>
                {busy ? "Arming…" : "Arm goal"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
