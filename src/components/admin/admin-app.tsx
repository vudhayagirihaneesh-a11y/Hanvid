"use client";

import { useState } from "react";
import { AdminMonitor } from "./admin-monitor";
import { RagManager } from "./rag-manager";
import { Film, Eye, BookOpen, ShieldCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ADMIN_PORTAL_KEY } from "@/lib/constants";

type Tab = "monitor" | "rag";

export function AdminApp({ adminKey }: { adminKey: string }) {
  const [tab, setTab] = useState<Tab>("monitor");

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "monitor", label: "Monitoring", icon: Eye },
    { id: "rag", label: "Knowledge Base", icon: BookOpen },
  ];

  return (
    <div className="min-h-screen bg-background bg-grid">
      {/* Admin header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">Hanvid Admin</span>
              <span className="hidden sm:inline text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Portal
              </span>
            </div>
          </div>
          <Button asChild variant="ghost" size="sm" className="gap-2">
            <a href="/">
              <ExternalLink className="w-3.5 h-3.5" />
              Exit to App
            </a>
          </Button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-border/60">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors relative -mb-px border-b-2 ${
                tab === t.id
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {tab === "monitor" && <AdminMonitor adminKey={adminKey} />}
        {tab === "rag" && <RagManager adminKey={adminKey} />}
      </div>

      <footer className="border-t border-border/60 mt-12 py-6 text-center text-xs text-muted-foreground">
        Hanvid Admin Portal · Secret access required · key:{" "}
        <code className="text-emerald-400/70">{ADMIN_PORTAL_KEY.slice(0, 4)}••••</code>
      </footer>
    </div>
  );
}
