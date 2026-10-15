"use client";
// Top bar: role switcher (stands in for login in the prototype), simulated date, demo controls.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, CalendarDays, ClipboardList, LayoutDashboard, RotateCcw, Stethoscope, Thermometer, SkipForward } from "lucide-react";
import { useStore } from "@/lib/store";
import { CAPACITY, fmtDay, isActive } from "@/lib/rules";

const ROLES = [
  { href: "/nurse", label: "Nurse", icon: Thermometer },
  { href: "/doctor", label: "Doctor", icon: Stethoscope },
  { href: "/admin", label: "Admin", icon: ClipboardList },
  { href: "/dashboard", label: "Head Doctor", icon: LayoutDashboard },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { today, patients, endDay, reset } = useStore();
  const occupied = patients.filter(isActive).length;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold text-teal-800">
            <Activity className="h-5 w-5" /> QuaranTrack
          </Link>
          <nav className="flex flex-wrap gap-1">
            {ROLES.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${path.startsWith(href) ? "bg-teal-50 text-teal-800" : "text-slate-600 hover:bg-slate-100"}`}>
                <Icon className="h-4 w-4" /> {label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 tabular-nums text-slate-700">
              Beds {occupied}/{CAPACITY}
            </span>
            <span className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-slate-700">
              <CalendarDays className="h-4 w-4" /> {fmtDay(today)}
            </span>
            <button onClick={() => confirm("Close today and move to the next day? Missed readings/visits will be logged.") && endDay()} className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-slate-700 hover:bg-slate-50" title="Demo: simulate the next day">
              <SkipForward className="h-4 w-4" /> End day
            </button>
            <button onClick={() => confirm("Reset all demo data?") && reset()} className="flex items-center gap-1 rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" title="Reset demo data">
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
