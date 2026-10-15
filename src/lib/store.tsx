"use client";
// Thin React wrapper around the pure engine: holds the state, persists it to
// localStorage, and exposes run(role, action). All rules live in engine.ts / rules.ts.
import { createContext, useContext, useEffect, useState } from "react";
import { Action, dispatch, Outcome, State } from "./engine";
import { Patient, Role } from "./rules";
import { seed } from "./seed";

export type { ActivityEvent } from "./engine";

const KEY = "quarantrack-v2";

function realToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function freshState(today = realToday()): State {
  return { today, patients: seed(today), events: [{ at: new Date().toISOString(), day: today, actor: "System", text: "Demo data loaded — 74/74 rooms occupied." }] };
}

interface Store extends State {
  /** Run an action as a role. Returns null on success, otherwise the outcome's error. */
  run(role: Role, action: Action): Extract<Outcome, { ok: false }> | null;
  reset(): void;
  get(id: string): Patient | undefined;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State | null>(null);

  // load once on the client (localStorage doesn't exist during server render)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      setState(raw ? JSON.parse(raw) : freshState());
    } catch {
      setState(freshState());
    }
  }, []);

  useEffect(() => {
    if (!state) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage blocked — demo still works in memory */
    }
  }, [state]);

  if (!state) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Loading facility data…</div>;
  }

  const store: Store = {
    ...state,
    get: (id) => state.patients.find((p) => p.id === id),
    run: (role, action) => {
      const out = dispatch(state, role, action);
      if (!out.ok) return out;
      setState(out.state);
      return null;
    },
    reset: () => setState(freshState()),
  };

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}
