"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { CAPACITY, canAdmit, daysBetween, freeRooms, isActive, isEligibleForDischarge, occupancyLevel, occupiesRoom } from "@/lib/rules";
import { Badge, Button, Card, Empty, PageHeader, PatientLink, Stat } from "@/components/ui";

export default function AdminPage() {
  const { patients, today, run } = useStore();
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const active = patients.filter(isActive);
  const occupying = patients.filter(occupiesRoom);
  const level = occupancyLevel(occupying.length);
  const queue = occupying.filter((p) => p.status === "discharge_approved" || p.status === "deceased");
  const unapproved = active.filter((p) => isEligibleForDischarge(p, today));
  const free = freeRooms(patients);
  const full = free.length === 0 ? canAdmit(patients) : null;
  const byRoom = new Map(occupying.map((p) => [p.room, p]));

  const doAdmit = () => {
    const err = run("admin", { type: "admit", name, age: age.trim() === "" ? NaN : Number(age) });
    if (err) return setMsg({ text: err.error, ok: false });
    setMsg({ text: `Admitted ${name} to Room ${free[0]}.`, ok: true });
    setName(""); setAge("");
  };

  return (
    <>
      <PageHeader title="Admin — admissions & discharges" subtitle="Discharge patients approved by doctors to free rooms for new admissions." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Occupancy" value={`${occupying.length}/${CAPACITY}`} tone={level === "full" ? "red" : level === "warn" ? "amber" : "green"} sub={free.length ? `${free.length} room(s) free` : "Full — discharge to admit"} />
        <Stat label="Discharge queue" value={queue.length} tone="violet" sub="approved or to release" />
        <Stat label="Awaiting doctor approval" value={unapproved.length} tone="amber" sub="meet 3-day criterion" />
        <Stat label="Discharged today" value={patients.filter((p) => p.status === "discharged" && p.outcomeOn === today).length} tone="blue" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Discharge queue & rooms to release">
            {queue.length === 0 ? <Empty>No approved discharges or rooms to release.</Empty> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-2">Room</th><th>Patient</th><th>Approved</th><th /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {queue.map((p) => {
                    const dead = p.status === "deceased";
                    const waiting = daysBetween((dead ? p.outcomeOn : p.approvedOn)!, today);
                    return (
                      <tr key={p.id} data-testid={`queue-row-${p.id}`}>
                        <td className="py-2.5 font-mono text-slate-600">{p.room}</td>
                        <td><PatientLink id={p.id} name={p.name} /> {dead && <Badge tone="red">Deceased</Badge>}</td>
                        <td>{waiting === 0 ? "Today" : <Badge tone="red">{waiting} day(s) ago — overdue</Badge>}</td>
                        <td className="text-right"><Button variant="success" onClick={() => run("admin", { type: "confirmDischarge", id: p.id })}>{dead ? "Release room" : "Confirm discharge"}</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Cured but not yet approved by doctor">
            {unapproved.length === 0 ? <Empty>None.</Empty> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {unapproved.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2">
                    <span><span className="mr-3 font-mono text-slate-600">Rm {p.room}</span><PatientLink id={p.id} name={p.name} /></span>
                    <Button variant="secondary" onClick={() => run("admin", { type: "remindDoctor", id: p.id })}>Remind doctor</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Admit patient">
            <form onSubmit={(e) => { e.preventDefault(); doAdmit(); }} className="space-y-3">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" aria-label="Patient name" disabled={!!full} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-teal-600 disabled:bg-slate-50" />
              <input value={age} onChange={(e) => setAge(e.target.value)} type="number" placeholder="Age" aria-label="Patient age" disabled={!!full} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-teal-600 disabled:bg-slate-50" />
              <Button type="submit" disabled={!!full} className="w-full">{full ? "No rooms available" : `Admit to Room ${free[0]}`}</Button>
              {full && <p className="text-xs text-red-700">{full}</p>}
              {msg && <Badge tone={msg.ok ? "green" : "red"}>{msg.text}</Badge>}
            </form>
          </Card>
          <Card title="Rooms">
            <div className="grid grid-cols-10 gap-1">
              {Array.from({ length: CAPACITY }, (_, i) => i + 1).map((r) => {
                const p = byRoom.get(r);
                const cls = !p ? "bg-white border-dashed border-slate-300 text-slate-400" : p.status === "deceased" ? "bg-slate-300 text-slate-700" : p.status === "discharge_approved" ? "bg-violet-200 text-violet-900" : "bg-teal-100 text-teal-900";
                return <div key={r} title={p ? `${p.name}` : "Free"} className={`flex aspect-square items-center justify-center rounded border border-transparent text-[10px] font-medium ${cls}`}>{r}</div>;
              })}
            </div>
            <div className="mt-3 flex gap-3 text-xs text-slate-600">
              <span><span className="mr-1 inline-block h-2 w-2 rounded bg-teal-200" />Occupied</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded bg-violet-300" />Discharge approved</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded bg-slate-300" />To release</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded border border-dashed border-slate-400" />Free</span>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
