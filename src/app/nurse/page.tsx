"use client";
import { useState } from "react";
import { Search } from "lucide-react";
import { useStore } from "@/lib/store";
import { addDays, canCorrectTemp, CRITICAL_C, FEVER_C, isActive, Patient, todayStatus } from "@/lib/rules";
import { Badge, Button, Card, Empty, PageHeader, PatientLink, Stat, Tabs, Temp } from "@/components/ui";

type Filter = "pending" | "done" | "all";

export default function NursePage() {
  const { patients, today } = useStore();
  const [filter, setFilter] = useState<Filter>("pending");
  const [q, setQ] = useState("");

  const active = patients.filter(isActive).sort((a, b) => a.room! - b.room!);
  const pending = active.filter((p) => !p.temps[today]);
  const done = active.length - pending.length;

  const shown = active
    .filter((p) => (filter === "pending" ? !p.temps[today] : filter === "done" ? !!p.temps[today] : true))
    .filter((p) => !q || `${p.name} ${p.id} ${p.room}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader title="Temperature rounds" subtitle="Record one reading per patient per day. Patients without today's reading are listed first." />
      <div data-testid="pending-banner" className={`mb-4 rounded-xl border px-4 py-3 text-sm ${pending.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
        {pending.length ? <><b>{pending.length} patients pending today</b> — temperature not yet recorded.</> : "All temperatures recorded for today."}
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Readings pending" value={pending.length} tone={pending.length ? "amber" : "green"} />
        <Stat label="Recorded today" value={`${done}/${active.length}`} tone="blue" />
        <Stat label="Fever today" value={active.filter((p) => (p.temps[today]?.value ?? 0) >= FEVER_C).length} tone="red" sub={`≥ ${FEVER_C.toFixed(1)} °C`} />
        <Stat label="Critical today" value={active.filter((p) => (p.temps[today]?.value ?? 0) >= CRITICAL_C).length} tone="red" sub={`≥ ${CRITICAL_C} °C — doctor alerted`} />
      </div>
      <Card
        title={
          <Tabs value={filter} onChange={setFilter} tabs={[
            { id: "pending", label: "Pending", count: pending.length },
            { id: "done", label: "Recorded", count: done },
            { id: "all", label: "All patients", count: active.length },
          ]} />
        }
        action={
          <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-2 py-1 text-sm">
            <Search className="h-4 w-4 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, ID or room" aria-label="Search patients" className="w-36 outline-none" />
          </label>
        }
      >
        {shown.length === 0 ? (
          <Empty>{filter === "pending" ? "All temperatures recorded for today." : "No patients match."}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr><th className="py-2 pr-3">Room</th><th className="pr-3">Patient</th><th className="pr-3">Yesterday</th><th className="pr-3">Today</th><th>Record</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((p) => <Row key={p.id} p={p} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Row({ p }: { p: Patient }) {
  const { today, run } = useStore();
  const [val, setVal] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ text: string; tone: "red" | "amber" | "green" } | null>(null);
  const [editing, setEditing] = useState(false);
  const reading = p.temps[today];
  const status = todayStatus(p, today);

  const submit = () => {
    // Number("37abc") is NaN, unlike parseFloat — so non-numbers are rejected
    const v = val.trim() === "" ? NaN : Number(val);
    const send = (confirmed: boolean) =>
      run("nurse", editing ? { type: "correctTemp", id: p.id, value: v, reason, confirmed } : { type: "logTemp", id: p.id, value: v, confirmed });
    let err = send(false);
    if (err?.needsConfirm) err = confirm(err.error) ? send(true) : { ok: false, error: "Not saved — please re-measure." };
    if (err) return setMsg({ text: err.error, tone: "red" });
    setVal(""); setReason(""); setEditing(false);
    setMsg(v >= CRITICAL_C ? { text: "Critical — doctor alerted", tone: "red" } : v >= FEVER_C ? { text: "Fever recorded", tone: "amber" } : { text: "Saved", tone: "green" });
  };

  const correctBlock = reading ? canCorrectTemp(p, today, reading.value) : null;

  return (
    <tr className="align-middle" data-testid={`nurse-row-${p.id}`}>
      <td className="py-2.5 pr-3 font-mono text-slate-600">{p.room}</td>
      <td className="pr-3">
        <PatientLink id={p.id} name={p.name} />
        <div className="text-xs text-slate-500">{p.id} · {p.age}y</div>
      </td>
      <td className="pr-3"><Temp value={p.temps[addDays(today, -1)]?.value} /></td>
      <td className="pr-3">
        {reading ? (
          <div>
            <Temp value={reading.value} />
            <div className="text-xs text-slate-500">{new Date(reading.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{status === "visited" && " · doctor reviewed"}</div>
          </div>
        ) : <Badge tone="amber">Pending</Badge>}
      </td>
      <td>
        {!reading || editing ? (
          <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-wrap items-center gap-2">
            <input aria-label={`Temperature for ${p.name}`} inputMode="decimal" value={val} onChange={(e) => { setVal(e.target.value); setMsg(null); }} placeholder="°C" className="w-20 rounded-lg border border-slate-300 px-2 py-1 tabular-nums outline-none focus:border-teal-600" />
            {editing && <input aria-label="Reason for correction" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className="w-40 rounded-lg border border-slate-300 px-2 py-1 outline-none focus:border-teal-600" />}
            <Button type="submit" disabled={!val}>{editing ? "Update" : "Save"}</Button>
            {editing && <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>}
          </form>
        ) : (
          <Button variant="secondary" disabled={!!correctBlock} title={correctBlock ?? "Fix a mistyped reading"} onClick={() => { setEditing(true); setVal(String(reading.value)); setMsg(null); }}>
            Correct
          </Button>
        )}
        {msg && <div className="mt-1"><Badge tone={msg.tone}>{msg.text}</Badge></div>}
      </td>
    </tr>
  );
}
