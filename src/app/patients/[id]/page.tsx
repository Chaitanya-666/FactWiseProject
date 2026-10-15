"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "@/lib/store";
import { addDays, CURE_DAYS, daysBetween, FEVER_C, fmtDay, normalStreak } from "@/lib/rules";
import { Badge, Card, Empty, PageHeader, Stat, Temp } from "@/components/ui";

const STATUS = { admitted: ["blue", "Admitted"], discharge_approved: ["violet", "Discharge approved"], discharged: ["green", "Discharged (cured)"], deceased: ["red", "Deceased"] } as const;

export default function PatientPage() {
  const { id } = useParams<{ id: string }>();
  const { get, today } = useStore();
  const p = get(id);
  if (!p) return <Empty>Patient not found. <Link href="/nurse" className="text-teal-700 underline">Back</Link></Empty>;

  const last = p.outcomeOn ?? today;
  const days = Array.from({ length: daysBetween(p.admittedOn, last) + 1 }, (_, i) => addDays(p.admittedOn, i));
  const chart = days.map((d) => ({ day: fmtDay(d), temp: p.temps[d]?.value ?? null }));
  const [tone, label] = STATUS[p.status];

  return (
    <>
      <PageHeader title={p.name} subtitle={`${p.id} · ${p.age} years · ${p.room ? `Room ${p.room}` : "No room"} · admitted ${fmtDay(p.admittedOn)}`}>
        <Badge tone={tone}>{label}</Badge>
      </PageHeader>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Today" value={<Temp value={p.temps[today]?.value} />} />
        <Stat label="Fever-free streak" value={`${normalStreak(p, today)}/${CURE_DAYS} days`} tone="green" />
        <Stat label="Days in facility" value={daysBetween(p.admittedOn, last)} tone="blue" />
        <Stat label="Doctor visits" value={Object.keys(p.visits).length} tone="violet" />
      </div>
      <Card title="Temperature history" className="mb-5">
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={chart} margin={{ top: 10, right: 20, bottom: 0, left: -10 }}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis domain={[35, 41]} unit="°" tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [`${v} °C`, "Temp"]} />
              <ReferenceLine y={FEVER_C} stroke="#d97706" strokeDasharray="4 4" label={{ value: "Fever 38 °C", fontSize: 11, fill: "#d97706", position: "insideTopRight" }} />
              <Line dataKey="temp" stroke="#0f766e" strokeWidth={2} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      {p.corrections?.length ? (
        <Card title="Corrections (readings are never deleted)" className="mb-5">
          <ul className="text-sm text-slate-700">
            {p.corrections.map((c, i) => <li key={i} className="py-1">{fmtDay(c.day)}: {c.from.toFixed(1)} → {c.to.toFixed(1)} °C by {c.by} — “{c.reason}”</li>)}
          </ul>
        </Card>
      ) : null}
      <Card title="Daily journal">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-2">Day</th><th>Temperature</th><th>Doctor visit</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {[...days].reverse().map((d) => (
              <tr key={d}>
                <td className="py-2">{fmtDay(d)}</td>
                <td>{p.temps[d] ? <Temp value={p.temps[d].value} /> : <Badge tone="amber">Missed</Badge>}</td>
                <td className="text-slate-700">{p.visits[d] ? `${p.visits[d].by}: ${p.visits[d].note}` : <span className="text-slate-400">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
