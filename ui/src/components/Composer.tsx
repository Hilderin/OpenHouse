import { useMemo, useState, type ReactNode } from "react"
import { useApp } from "../app-context"
import type { Agent, Model, ModelRef } from "../types"
import { modelKey, modelLabel, variantLabels } from "../format"

function groupByProvider<T extends { providerID: string }>(models: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const m of models) {
    const list = map.get(m.providerID) ?? []
    list.push(m)
    map.set(m.providerID, list)
  }
  return map
}

function primaryAgents(agents: Agent[]): Agent[] {
  return agents.filter((a) => a.mode === "primary" || a.mode === "all")
}

export function Composer(): ReactNode {
  const { state, sendPrompt, interrupt, switchModel, switchAgent } = useApp()
  const { chat } = state
  const [draft, setDraft] = useState("")
  const [variant, setVariant] = useState("")

  const grouped = useMemo(() => groupByProvider(state.models.data), [state.models.data])
  const agents = useMemo(() => primaryAgents(state.agents.data), [state.agents.data])

  const session = chat.session
  const currentModel: ModelRef | undefined = session?.model
  const modelValue = currentModel ? modelKey({ providerID: currentModel.providerID, id: currentModel.id }) : ""
  const selectedModelEntry = useMemo(
    () => state.models.data.find((m) => m.providerID === currentModel?.providerID && m.id === currentModel?.id),
    [state.models.data, currentModel],
  )
  const variants = useMemo(() => variantLabels(selectedModelEntry?.variants), [selectedModelEntry])
  const busy = session?.status === "busy" || session?.status === "retry"

  if (!chat.sessionId || !session) return null

  const send = async () => {
    const text = draft
    if (!text.trim()) return
    setDraft("")
    await sendPrompt(text)
  }

  const pickModel = (value: string) => {
    if (!value) {
      if (state.defaultModel) void switchModel(state.defaultModel)
      return
    }
    const [providerID, id] = value.split("/")
    if (!providerID || !id) return
    const entry: Model | undefined = state.models.data.find((m) => m.providerID === providerID && m.id === id)
    const labels = variantLabels(entry?.variants)
    const nextVariant = labels.includes(variant) ? variant : undefined
    void switchModel({ providerID, id, ...(nextVariant ? { variant: nextVariant } : {}) })
  }

  const pickVariant = (value: string) => {
    setVariant(value)
    if (!currentModel) return
    void switchModel({ providerID: currentModel.providerID, id: currentModel.id, ...(value ? { variant: value } : {}) })
  }

  return (
    <div className="composer">
      <textarea
        className="textarea composer-input"
        placeholder="Send a prompt…  (Enter to send, Shift+Enter for newline)"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            void send()
          }
        }}
        rows={3}
      />

      <div className="composer-bottom">
        <div className="composer-pickers">
          <select
            className="mini-select"
            value={modelValue}
            onChange={(e) => pickModel(e.target.value)}
            title="Model"
            aria-label="Model"
          >
            <option value="">
              Default{state.defaultModel ? ` (${modelLabel(state.defaultModel)})` : ""}
            </option>
            {[...grouped.entries()].map(([provider, models]) => (
              <optgroup key={provider} label={provider}>
                {models.map((m) => (
                  <option key={modelKey(m)} value={modelKey(m)}>
                    {m.name || m.id}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          {variants.length > 0 ? (
            <select
              className="mini-select"
              value={currentModel?.variant ?? variant}
              onChange={(e) => pickVariant(e.target.value)}
              title="Reasoning variant"
              aria-label="Variant"
            >
              <option value="">Default variant</option>
              {variants.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : null}

          <select
            className="mini-select"
            value={session.agent ?? ""}
            onChange={(e) => void switchAgent(e.target.value)}
            title="Agent"
            aria-label="Agent"
          >
            <option value="" disabled>
              Agent…
            </option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.id}
              </option>
            ))}
          </select>
        </div>

        <div className="composer-actions">
          {busy ? <span className="muted small">busy…</span> : <span className="muted small">Enter to send</span>}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void interrupt()}
            disabled={!busy}
            title="Interrupt"
          >
            Stop
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => void send()} disabled={chat.sending || !draft.trim()}>
            {chat.sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  )
}
