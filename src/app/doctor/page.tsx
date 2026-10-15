"use client";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useStore } from "@/lib/store";
import type { Action } from "@/lib/engine";
import { canApproveDischarge, canVisit, CRITICAL_C, CURE_DAYS, isActive, isEligibleForDischarge, normalStreak, Patient, todayStatus } from "@/lib/rules";
import { Badge, Button, Card, Empty, PageHeader, PatientLink, Stat, Tabs, Temp } from "@/components/ui";

type View = "ready" | "pending" | "visited" | "eligible";

export default function DoctorPage() {
  const { patients, today } = useStore();
  const [view, setView] = useState<View>("ready");
  const active = patients.filter(isActive);

  const byTemp = (a: Patient, b: Patient) => Number(!!b.flag) - Number(!!a.flag) || (b.temps[today]?.value ?? 0) - (a.temps[today]?.value ?? 0);
  const groups: Record<View, Patient[]> = {
    ready: active.filter((p) => todayStatus(p, today) === "ready_for_doctor").sort(byTemp), // hottest first
    pending: active.filter((p) => todayStatus(p, today) === "temp_pending").sort((a, b) => a.room! - b.room!),
    visited: active.filter((p) => todayStatus(p, today) === "visited").sort((a, b) => a.room! - b.room!),
    eligible: active.filter((p) => isEligibleForDischarge(p, today)).sort((a, b) => a.room! - b.room!),
  };
  const critical = active.filter((p) => (p.temps[today]?.value ?? 0) >= CRITICAL_C && !p.visits[today]);

  return (
    <>
      <PageHeader title="Doctor rounds" subtitle="Visit patients after the nurse has recorded today's temperature. Highest temperatures are listed first." />
      {critical.length > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4" /> <b>{critical.length} critical</b> patient(s) not yet visited: {critical.map((p) => `${p.name} (Room ${p.room})`).join(", ")}
        </div>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Ready for visit" value={groups.ready.length} tone="blue" sub="temperature taken" />
        <Stat label="Awaiting temperature" value={groups.pending.length} tone="amber" sub="don't visit yet" />
        <Stat label="Visited today" value={`${groups.visited.length}/${active.length}`} tone="green" />
        <Stat label="Eligible for discharge" value={groups.eligible.length} tone="violet" sub={`${CURE_DAYS} fever-free days`} />
      </div>
      <Card title={<Tabs value={view} onChange={setView} tabs={[
        { id: "ready", label: "Ready for visit", count: groups.ready.length },
        { id: "pending", label: "Awaiting temperature", count: groups.pending.length },
        { id: "visited", label: "Visited today", count: groups.visited.length },
        { id: "eligible", label: "Eligible for discharge", count: groups.eligible.length },
      ]} />}>
        {groups[view].length === 0 ? <Empty>Nothing here right now.</Empty> : (
          <div className="divide-y divide-slate-100">{groups[view].map((p) => <Row key={p.id} p={p} />)}</div>
        )}
      </Card>
    </>
  );
}

function Row({ p }: { p: Patient }) {
  const { today, run } = useStore();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const streak = normalStreak(p, today);
  const visitBlock = canVisit(p, today);
  const approveBlock = canApproveDischarge(p, today);
  const exec = (a: Action) => { const e = run("doctor", a); setErr(e?.error ?? null); if (!e) setOpen(false); };

  return (
    <div className="py-3" data-testid={`doctor-row-${p.id}`}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="w-14 font-mono text-sm text-slate-600">Rm {p.room}</div>
        <div className="min-w-44 flex-1">
          <PatientLink id={p.id} name={p.name} />
          <div className="text-xs text-slate-500">{p.id} · {p.age}y · admitted {p.admittedOn}</div>
        </div>
        <div className="w-24 text-sm"><Temp value={p.temps[today]?.value} /></div>
        <div className="w-40">
          <div className="text-xs text-slate-500">Fever-free days</div>
          <div className="flex gap-1">{Array.from({ length: CURE_DAYS }, (_, i) => <span key={i} className={`h-2 w-8 rounded-full ${i < streak ? "bg-emerald-500" : "bg-slate-200"}`} />)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.status === "discharge_approved" && <Badge tone="violet">Discharge approved</Badge>}
          {p.flag && <Badge tone="red">Needs review</Badge>}
          {p.visits[today] && <Badge tone="green">Visited</Badge>}
          {!p.visits[today] && <Button disabled={!!visitBlock} title={visitBlock ?? ""} onClick={() => setOpen(!open)}>{!p.temps[today] ? "Temperature not recorded yet" : "Mark visited"}</Button>}
          {p.status === "admitted" && <Button variant="success" disabled={!!approveBlock} title={approveBlock ?? "Send to admin discharge queue"} onClick={() => exec({ type: "approveDischarge", id: p.id })}>Approve discharge</Button>}
          <Button variant="danger" onClick={() => confirm(`Record ${p.name} as deceased? This frees the room and cannot be undone.`) && exec({ type: "markDeceased", id: p.id })}>Deceased</Button>
        </div>
      </div>
      {open && (
        <form onSubmit={(e) => { e.preventDefault(); exec({ type: "recordVisit", id: p.id, note }); }} className="mt-3 flex gap-2 pl-14">
          <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Treatment / observation notes" className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-teal-600" />
          <Button type="submit">Save visit</Button>
        </form>
      )}
      {p.flag && <div className="mt-2 pl-14 text-sm text-red-700">{p.flag}</div>}
      {err && <div className="mt-2 pl-14"><Badge tone="red">{err}</Badge></div>}
    </div>
  );
}
