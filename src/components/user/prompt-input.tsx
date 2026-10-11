"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Sparkles, Monitor } from "lucide-react";
import { QueueBanner } from "./queue-banner";
import { ErrorBoundary } from "./error-boundary";

const DIRECTOR_PRESETS = [
  { id: "cinema", label: "🎬 Cinematic 8K", suffix: "shot on 35mm Arri Alexa, Master Prime lens, natural volumetric lighting, shallow depth of field, 8k resolution" },
  { id: "portrait", label: "👤 Portrait Two-Shot", suffix: "cinematic eye-level medium two-shot, clear subject framing, authentic facial expressions and natural human posture" },
  { id: "steadicam", label: "🎥 Steadicam", suffix: "fluid Steadicam tracking shot at eye level, smooth 3-axis stabilized motion, crisp optical focus" },
  { id: "physics", label: "🔬 Physics Sim", suffix: "authentic scientific simulation, precision physical dynamics, conservation of momentum, photorealistic optical caustics" },
  { id: "detail", label: "✨ Ultra Detail", suffix: "photorealistic fine textures, natural subsurface scattering, 8k resolution, crisp optical clarity" },
  { id: "drone", label: "🚁 Drone Aerial", suffix: "sweeping cinematic drone flyover, orbital camera motion, expansive atmospheric perspective, golden hour" },
  { id: "cyberpunk", label: "⚡ Cyberpunk", suffix: "cyberpunk aesthetic, vibrant neon reflections, volumetric rain haze, anamorphic lens flare" },
];

const RESOLUTION_OPTIONS = [
  { id: "1080p", label: "1080p FHD", badge: "1080p", desc: "1920×1080" },
  { id: "2k", label: "2K QHD", badge: "2K", desc: "2560×1440 · Fast & Sharp" },
  { id: "4k", label: "4K UHD", badge: "4K", desc: "3840×2160 · Ultra Detail" },
];

export function PromptInput({
  onSend,
  disabled,
  placeholder = "Describe the video you want to create…",
}: {
  onSend: (content: string, resolution?: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [activePresets, setActivePresets] = useState<string[]>([]);
  const [resolution, setResolution] = useState<string>("2k");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = Math.min(ref.current.scrollHeight, 160) + "px";
    }
  }, [value]);

  const send = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    const activeSuffixes = DIRECTOR_PRESETS.filter((p) => activePresets.includes(p.id)).map((p) => p.suffix);
    const finalPrompt = activeSuffixes.length > 0 ? `${trimmed}, ${activeSuffixes.join(", ")}` : trimmed;
    onSend(finalPrompt, resolution);
    setValue("");
  };

  const togglePreset = (id: string) => {
    setActivePresets((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
    ref.current?.focus();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="border-t border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="max-w-3xl mx-auto px-4 py-3">
        <ErrorBoundary>
          <QueueBanner />
        </ErrorBoundary>

        {/* AI Director Quick Controls */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-2 mb-1 scroll-smooth">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 shrink-0 mr-1 pl-1">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Director:</span>
          </div>
          {DIRECTOR_PRESETS.map((p) => {
            const isActive = activePresets.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => togglePreset(p.id)}
                disabled={disabled}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all shrink-0 whitespace-nowrap active:scale-95 ${
                  isActive
                    ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300 shadow-sm shadow-emerald-500/10"
                    : "border-border/70 bg-card/60 hover:bg-emerald-500/15 hover:border-emerald-500/40 text-muted-foreground hover:text-emerald-300"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Resolution Options Pill Bar */}
        <div className="flex items-center justify-between pb-2 mb-1 px-1">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-sky-400 shrink-0">
              <Monitor className="w-3.5 h-3.5" />
              <span>Upscale:</span>
            </div>
            <div className="inline-flex p-0.5 rounded-lg bg-card/70 border border-border/60 backdrop-blur">
              {RESOLUTION_OPTIONS.map((opt) => {
                const isSelected = resolution === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setResolution(opt.id)}
                    disabled={disabled}
                    className={`px-2.5 py-0.5 rounded-md text-[11px] font-medium transition-all ${
                      isSelected
                        ? "bg-sky-500/25 text-sky-200 border border-sky-400/40 shadow-sm shadow-sky-500/15"
                        : "text-muted-foreground hover:text-foreground border border-transparent"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <span className="hidden sm:inline text-[11px] text-muted-foreground/70 font-mono">
            {resolution === "4k"
              ? "3840×2160 UHD · Lanczos High Precision"
              : resolution === "2k"
              ? "2560×1440 QHD · Sharp & Balanced (Default)"
              : "1920×1080 FHD · Standard"}
          </span>
        </div>
        
        <div className="relative flex flex-col rounded-2xl border border-border/60 bg-card/60 backdrop-blur p-2 focus-within:border-emerald-500/40 transition-colors">
          <div className="flex items-end gap-2 w-full">
            <Textarea
              ref={ref}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKey}
              placeholder={placeholder}
              disabled={disabled}
              rows={1}
              className="min-h-[44px] max-h-40 w-full resize-none bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-3 py-2 text-sm"
            />
            <Button
              onClick={send}
              disabled={disabled || !value.trim()}
              size="icon"
              className="h-10 w-10 shrink-0 rounded-xl"
            >
              {disabled ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground/70 text-center mt-2 flex justify-center items-center gap-2">
          <span>Press Enter to send · Shift+Enter for a new line</span>
          <span className="w-1 h-1 rounded-full bg-border"></span>
          <span>Pure Text-to-Video Mode · Wan 2.2 14B</span>
        </p>
      </div>
    </div>
  );
}
