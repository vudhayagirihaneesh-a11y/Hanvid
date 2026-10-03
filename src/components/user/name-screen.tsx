"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Film, ArrowRight, Sparkles } from "lucide-react";
import { api, User, storeUser } from "@/lib/api-client";
import { toast } from "sonner";

export function NameScreen({ onReady }: { onReady: (u: User) => void }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Please enter your name");
      return;
    }
    setLoading(true);
    try {
      // Try to find an existing user with this name first.
      const { user: existing } = await api.lookupUser(trimmed);
      if (existing) {
        storeUser(existing);
        toast.success(`Welcome back, ${existing.name}!`);
        onReady(existing);
        return;
      }
      const { user } = await api.createUser(trimmed);
      storeUser(user);
      toast.success(`Welcome, ${user.name}!`);
      onReady(user);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sign in");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-cinematic bg-grid relative overflow-hidden">
      {/* ambient glow */}
      <div className="pointer-events-none absolute -top-40 -left-40 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-96 h-96 bg-fuchsia-500/10 rounded-full blur-3xl" />

      <header className="relative z-10 px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <Film className="w-5 h-5 text-emerald-400" />
          </div>
          <span className="font-semibold tracking-tight text-lg">Hanvid</span>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-md text-center space-y-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
              <Sparkles className="w-3 h-3" />
              AI Video Generation Studio
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
              Turn your words into{" "}
              <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
                cinematic videos
              </span>
            </h1>
            <p className="text-muted-foreground text-base sm:text-lg leading-relaxed">
              Describe a scene, hit generate, and watch our AI model bring your
              prompt to life. Continue the conversation to refine your vision.
            </p>
          </div>

          <div className="space-y-3">
            <div className="relative">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loading && submit()}
                placeholder="Enter your name to start…"
                className="h-14 text-base pr-14 bg-background/60 backdrop-blur border-border/60 focus-visible:border-emerald-500/50"
                disabled={loading}
                autoFocus
              />
              <Button
                onClick={submit}
                disabled={loading || !name.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 p-0 rounded-lg"
                size="icon"
              >
                <ArrowRight className="w-5 h-5" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              No signup needed — just your name. Your chats are saved locally.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-4">
            {[
              { icon: "🎬", label: "Text-to-video" },
              { icon: "💬", label: "Chat history" },
              { icon: "✨", label: "RAG-enhanced" },
            ].map((f) => (
              <div
                key={f.label}
                className="rounded-lg border border-border/50 bg-card/40 p-3 text-center"
              >
                <div className="text-xl mb-1">{f.icon}</div>
                <div className="text-xs text-muted-foreground">{f.label}</div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="relative z-10 px-6 py-4 text-center text-xs text-muted-foreground">
        Hanvid Studio · Generate responsibly
      </footer>
    </div>
  );
}
