# Hanvid Launch Playbook — From Local Build to "Famous Out There"

You have something most AI-video projects don't: a **fully local, private,
chat-style video studio** that runs on a single consumer GPU (RTX 5070, 8GB).
That's the story. Everything below is built around it.

---

## 1. Positioning (pick this and repeat it everywhere)

> **"The AI video studio that runs 100% on your own GPU. No cloud. No
> credits. No content police. Your prompts, your models, your machine."**

Three differentiators to hammer:

1. **Local & private** — prompts/videos never leave the machine. Say it in
   every video description. Privacy sells hard right now.
2. **Chat-native** — you *talk* to it like ChatGPT and it returns a finished
   video with sound (RAG-enhanced prompting included). Screenshot-friendly.
3. **Consumer hardware** — "this ran on an 8GB RTX 5070, at my desk" is an
   underdog hook that outperforms "we use 40 H100s" every time.

Name check: "Hanvid" is short, brandable, and reads as "hand-made video" —
lean into that ("Hanvid: hand-crafted video, made by your GPU").

## 2. The 60-second demo that does the marketing

One video, one take, screen-recorded:

1. Open Hanvid → type a cinematic prompt ("drone shot over a neon Tokyo
   alley in the rain, reflections, slow push-in").
2. Show the queue/progress (people love watching progress bars).
3. Video plays — **then run `nvidia-smi` in a corner window** showing the
   RTX 5070 doing the work, and `verify_setup.py` ending in ✅.
4. End card: "0 API calls. 0 dollars. Runs on an 8GB GPU. Link in bio."

Post this exact video, with small variations, to: X/Twitter, Reddit
(r/StableDiffusion, r/comfyui, r/LocalLLaMA — they *love* local-first tools),
Hacker News (Show HN), r/aivideo, and TikTok/YouTube Shorts (vertical cut).

## 3. Content engine (2 weeks of posts from one build)

| Day | Post | Hook |
|---|---|---|
| 1 | The 60s demo above | "I replaced my $30/mo video AI with my GPU" |
| 3 | Before/after: same prompt, broken settings vs fixed | "Why your local AI videos look weak" |
| 5 | The polish pipeline explained (flicker → clean) | "3 lines of ffmpeg fixed my AI video" |
| 7 | RTX 5070 bug thread ("no kernel image" fix) | Saves people hours = shares |
| 9 | Speed timelapse: 5s clip, 2 minutes, on 8GB | Underdog hardware story |
| 11 | "ChatGPT but it returns videos" screen record | The chat-native angle |
| 13 | Open-source teaser / roadmap poll | Community ownership |

The "why your local AI videos look weak" post is your best organic bet:
the distilled-vs-standard settings bug you *actually had and fixed* is
something thousands of people hit and nobody explains well. Write it as a
tutorial, not an ad.

## 4. Distribution targets, in order of ROI

1. **r/StableDiffusion + r/LocalLLaMA** — the exact audience; local-first is
   a religion there. Post the tuning table from `RTX5070_TUNING.md` as an
   image.
2. **Hacker News (Show HN)** — lead with the architecture (Next.js + FastAPI
   + diffusers, model-service split, realtime socket.io). HN upvotes
   engineering honesty; include the FIXES.md war stories.
3. **X/Twitter** — thread format: 8–10 short posts, each one a tip or a
   clip. Pin the demo.
4. **GitHub** — public repo, good README, the verify_setup doctor as your
   "it just works" signal. Stars compound into credibility.
5. **YouTube Shorts/TikTok** — vertical cuts of generated videos with the
   prompt overlaid. Zero production cost, infinite volume.

## 5. Product moves that create fame (not just noise)

- **Ship a "Show HN-ready" public demo**: guest mode with 3 free demo-prompt
  videos (the demo-generator path you already have), full experience after
  login. Lowers the try-bar to zero.
- **Publish the benchmark**: "RTX 5070, 8GB: 5s 480p clip in X min, $0.00"
  vs subscription prices. Numbers travel.
- **Weekly model drops**: the service is model-agnostic by design — when a
  better open video model drops, swap the checkpoint, ship an update, post
  "Hanvid now runs <new model>, still 8GB." You ride every model's hype wave
  for free.
- **Community prompts gallery**: let users publish their prompt + result;
  seed it with 20 great ones yourself. Becomes your SEO landing pages.
- **The accuracy angle**: "accurate videos" is your differentiating claim —
  show side-by-sides vs generic local tools (same seed, same prompt). Own
  the word *accurate*.

## 6. Credibility hygiene (don't skip)

- Keep `verify_setup.py` green in your demo videos — it's your trust badge.
- Be explicit in posts that heavy models ship as optional downloads
  (transparency about VRAM needs avoids "it doesn't run on my laptop"
  backlash; point them at demo mode).
- Rotate/never ship real credentials in public zips (the repo's `.env` is
  excluded from the archive for exactly this reason — keep it that way).
- Credit the model authors (Wan team / Phr00t quantizations / MMAudio) in
  the README and in posts. The local-AI community punishes missing credits
  and rewards generosity loudly.

## 7. 30-day scoreboard

| Metric | Target by day 30 |
|---|---|
| GitHub stars | 500+ |
| Show HN front page | 1x attempt |
| Reddit karma from posts | 2k+ |
| Demo video views (all platforms) | 100k+ |
| Guest-mode generations | 1,000+ |
| "It runs on MY GPU too" comments | 50+ (reply to every one) |

The last row is the real one — every person who gets it running on their own
machine and says so publicly is a permanent advocate. Ship the tuning guide,
answer every hardware question with the exact env vars, and the community
markets you.
