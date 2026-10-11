const docs = [
  {
    title: "Wan2.1 Prompt Structure — The 6-Part Formula",
    tags: "prompt-engineering, core, structure, template",
    content: `Every effective Wan2.1 text-to-video prompt follows a six-part structure. Lead with the subject, then action, then setting/environment, then style, then camera treatment, then lighting. This order matches how the model allocates attention and produces the most coherent, controllable output.
Formula: [Subject] + [Action/Pose] + [Setting/Environment] + [Visual Style] + [Camera Movement] + [Lighting/Atmosphere]
• Subject: who or what is the focus — be specific (a young woman in a red coat, a golden retriever, an old lighthouse)
• Action: what is happening — use active verbs (walking, gazing, spinning, pouring, drifting)
• Setting: where it happens — environment details (on a cobblestone street, in a misty forest, atop a cliff)
• Style: aesthetic treatment (cinematic, photorealistic, anime, watercolor, 3D render, film noir)
• Camera: movement and angle (slow dolly-in, tracking shot, aerial drone, low angle, static wide shot)
• Lighting: quality and direction (golden hour backlight, soft overcast, neon-lit, candlelit, moonlight)
Example enhanced prompt: A young woman in a flowing red coat walking slowly through a misty autumn forest, cinematic photorealistic style, slow tracking dolly shot from the side, soft golden-hour backlight filtering through the trees.`
  },
  {
    title: "Cinematic Camera Movements Vocabulary",
    tags: "camera, cinematic, movement, vocabulary",
    content: `Camera movement is the single most important differentiator between amateur and professional-looking generated video. Specify the movement explicitly — Wan2.1 defaults to a static or simple zoom when none is given.
• Static / Locked-off: no camera movement. Best for portraits and still-life compositions.
• Pan: camera rotates horizontally left or right. Use 'slow pan left' or 'pan right across the scene'.
• Tilt: camera rotates vertically up or down. Use 'tilt up to reveal the sky' or 'slow tilt down'.
• Dolly: camera moves physically toward or away from subject. 'Slow dolly-in' builds intimacy; 'dolly-out' reveals scale.
• Tracking / Trucking: camera moves sideways parallel to subject. 'Side tracking shot following the runner'.
• Crane / Boom: vertical camera travel. 'Crane shot rising over the buildings'.
• Handheld: subtle shake for documentary feel. 'Handheld camera, slight shake'.
• Aerial / Drone: bird's-eye or high-angle overview. 'Aerial drone shot descending over the valley'.
• Orbit: camera circles the subject. 'Slow 360-degree orbit around the character'.
• Push-in / Pull-out: zoom-like dolly. 'Slow push-in on the face'.
Tip: Combine at most two movements (e.g. 'dolly-in while tilting up'). Three or more confuse the model and produce jittery output.`
  },
  {
    title: "Lighting Conditions & Times of Day",
    tags: "lighting, atmosphere, time-of-day, vocabulary",
    content: `Lighting defines the emotional tone of a shot. The model responds strongly to named lighting conditions — use the exact phrases below for predictable results.
• Golden hour: warm low-angle sunlight just after sunrise or before sunset. Soft, flattering, cinematic. Pairs with 'warm glow', 'long shadows'.
• Blue hour: cool twilight just before sunrise or after sunset. Dreamy, moody, melancholic.
• Midday sun: harsh top-down light, strong shadows. Use deliberately for stark, high-contrast looks.
• Overcast / diffused: soft even light, no hard shadows. Ideal for portraits and product shots.
• Neon-lit: colored artificial lighting, usually at night. Use 'neon-lit city street', 'pink and cyan neon glow'.
• Candlelit: warm flickering low light. Intimate, cozy, dramatic.
• Moonlight: cool blue-silver low light. Mysterious, serene, nocturnal.
• Backlit: light source behind subject, creating rim-light or silhouette. 'Backlit by the setting sun'.
• Volumetric / god rays: visible light beams through fog or dust. 'Sun rays piercing through the forest canopy'.
• Three-point lighting: professional key + fill + rim setup. Use for studio-quality portraits.
Anti-pattern: Avoid 'bright light' or 'good lighting' — these are too vague. Always name the source and quality.`
  },
  {
    title: "Genre & Style Templates",
    tags: "style, genre, template, aesthetic",
    content: `Pin the visual style explicitly. Without a style cue, Wan2.1 defaults to a neutral photorealistic look that often feels flat.
• Cinematic photoreal: 'cinematic photorealistic style, shot on 35mm film, shallow depth of field, anamorphic lens flare'. Best for narrative film looks.
• Documentary: 'natural documentary style, handheld camera, available light, unposed'. For realistic, journalistic feel.
• Anime: 'anime style, cel-shaded, vibrant colors, Studio Ghibli-inspired'. Soft backgrounds, expressive characters.
• 3D Render / Pixar: '3D animated style, soft global illumination, subsurface scattering, Pixar-like'. For character animation.
• Film noir: 'black and white film noir, high contrast, dramatic shadows, venetian blind shadows'. 1940s detective aesthetic.
• Watercolor / painterly: 'watercolor painting style, soft bleeding edges, pastel palette'. Artistic, dreamlike.
• Hyperreal: 'hyperrealistic, 8K detail, razor-sharp focus, professional photography'. Maximum fidelity.
• Vaporwave / retro: 'retro 80s vaporwave aesthetic, neon grid, magenta and cyan, VHS scan lines'. Nostalgic synthwave.
• Minimalist: 'minimalist composition, negative space, single subject, muted palette'. Clean and modern.
• Claymation: 'claymation stop-motion style, visible fingerprints, handmade texture'. Tactile and charming.`
  },
  {
    title: "Nature & Landscape Scene Template",
    tags: "nature, landscape, template, scene",
    content: `Landscape scenes thrive on scale, atmosphere, and slow camera movement. Lead with the geographic feature, then weather, then light, then a slow camera move.
Template: [Geographic feature] + [Weather/Atmosphere] + [Time of day & lighting] + [Slow camera move] + [Style]
• Example — mountain lake: A serene mountain lake at sunrise, low mist drifting across the water, golden-hour light reflecting off the surface, slow aerial drone shot descending toward the water, cinematic photorealistic style.
• Example — forest: An ancient redwood forest, god rays piercing through the canopy, soft moss-covered ground, slow tracking shot moving forward through the trees, cinematic style, shallow depth of field.
• Example — desert: Vast sand dunes at blue hour, cool blue shadows, rippled sand textures, slow pan across the dunes, minimalist composition.
• Example — ocean: Rugged coastline with crashing waves, sea spray catching the backlight, golden-hour sun low on the horizon, slow crane shot rising over the cliff edge.
Keywords that boost nature quality: pristine, untouched, vast, serene, dramatic, ethereal, majestic, tranquil.`
  },
  {
    title: "Urban & City Scene Template",
    tags: "urban, city, template, scene, night",
    content: `Urban scenes come alive with motion, light, and human texture. Specify the street type, time of day, light sources, and camera movement that captures the energy.
Template: [Street/location type] + [Time of day & light sources] + [Motion elements] + [Camera move] + [Style]
• Example — neon city: A rain-slicked Tokyo street at night, neon signs in pink and cyan reflecting off wet pavement, pedestrians with umbrellas passing by, slow tracking dolly shot moving forward, cinematic photorealistic style, anamorphic lens flare.
• Example — skyline: Aerial drone shot flying over a dense city skyline at dusk, buildings glowing with interior lights, traffic light trails on the highways below, slow descending orbit.
• Example — cafe: A cozy Parisian cafe interior in the evening, warm pendant lighting, steam rising from a coffee cup on the counter, slow push-in on the cup, shallow depth of field.
• Example — alley: A narrow cobblestone alley in old Europe, afternoon sun casting long shadows, hanging laundry overhead, slow tracking shot following a cat walking through.
Urban quality boosters: bustling, vibrant, atmospheric, cinematic, moody, lived-in, golden.`
  },
  {
    title: "Portrait & Character Scene Template",
    tags: "portrait, character, people, template",
    content: `Character-driven shots need specificity in face, wardrobe, posture, and gaze direction. Vague subjects ('a person') produce generic, uncanny results.
Template: [Specific subject: age, hair, wardrobe] + [Pose & gaze] + [Setting] + [Camera angle & lens] + [Lighting] + [Style]
• Example — cinematic portrait: A young woman with shoulder-length auburn hair wearing a cream trench coat, gazing off camera to the right, standing on a rainy city street at night, close-up shot at eye level, 85mm lens, shallow depth of field, neon rim lighting, cinematic photorealistic style.
• Example — child: A young boy with curly black hair in a yellow raincoat, laughing as he runs through a sunlit field of flowers, tracking shot following alongside him, golden-hour backlight, soft focus background.
• Example — elder: An elderly fisherman with a weathered face and white beard, wearing a yellow rain slicker, mending a net on a wooden dock, medium shot, soft overcast light, documentary style.
Tip: Always specify gaze direction ('looking at camera', 'gazing off to the left', 'eyes closed') — the model cannot guess. Specify lens length (35mm for environmental, 85mm for flattering portrait, 24mm for wide distortion).`
  },
  {
    title: "Motion & Pacing Control",
    tags: "motion, pacing, slow-motion, time-lapse",
    content: `Wan2.1 supports explicit motion-speed modifiers. Use them to control whether the action feels real-time, dreamlike, or frenetic.
• Real-time: default; no modifier needed. Natural pacing.
• Slow motion: 'in slow motion', 'slow-motion capture at 120fps'. Adds drama and grace to movement (water splashes, hair flowing, falling petals).
• Extreme slow motion: 'ultra slow motion, 1000fps'. For explosions, splashes, impact moments.
• Time-lapse: 'time-lapse over several hours'. Clouds racing, shadows moving, flowers blooming.
• Hyperlapse: 'hyperlapse traveling through the city, sped up'. Combines camera movement with time compression.
• Freeze frame: 'action freezes mid-air, held for a beat, then resumes'. For dramatic emphasis.
• Speed ramp: 'starts slow, accelerates, then slows again'. Modern music-video feel.
Pairing tip: Slow motion pairs beautifully with 'water droplets suspended in air', 'petals drifting', 'dust particles floating'. These small details make slow-motion shots feel intentional.`
  },
  {
    title: "Color Palette & Grading Terms",
    tags: "color, grading, palette, vocabulary",
    content: `Explicit color palettes give the model a clear target. Named grading styles (teal-orange, bleach bypass) produce predictable, professional results.
• Teal and orange: the blockbuster film grade. Shadows pushed teal, highlights pushed warm orange. 'teal and orange color grade, cinematic'.
• Desaturated / muted: 'desaturated palette, muted tones'. Documentary or melancholic feel.
• Monochrome / black-and-white: 'black and white, high contrast'. Timeless, dramatic.
• Warm / sepia: 'warm sepia tones, golden cast'. Nostalgic, vintage.
• Cool / cyan: 'cool cyan tones, blue cast'. Cold, clinical, futuristic.
• Pastel: 'soft pastel palette, baby pink and mint'. Whimsical, dreamy.
• Vibrant / saturated: 'highly saturated, punchy colors'. Tropical, energetic.
• Bleach bypass: 'bleach bypass grade, retained silver, desaturated with deep blacks'. Gritty, Saving-Private-Ryan look.
• Two-tone: 'two-tone palette, magenta and teal'. Stylized, music-video aesthetic.
Tip: Combine a palette with a style for lock-in. e.g. 'teal-orange grade, anamorphic, shot on 35mm film' produces a very consistent filmic result.`
  },
  {
    title: "Aspect Ratio & Framing Guidance",
    tags: "aspect-ratio, framing, composition, technical",
    content: `Aspect ratio shapes composition before any other choice. The app supports several sizes — pick the one matching the viewing context.
• 16:9 (landscape, 1344×768): default. Cinematic, YouTube, desktop. Best for landscapes, environments, wide scenes.
• 9:16 (vertical, 768×1344): mobile-first, TikTok/Reels/Shorts. Best for portraits, talking-head, vertical compositions.
• 1:1 (square, 1024×1024): social feed, Instagram. Balanced, graphic compositions.
• 4:3 (1024×768): classic TV, retro feel. Slightly boxy.
• 21:9 (1440×720): ultra-wide cinematic. Letterboxed film look.
Framing terms the model understands: extreme wide shot, wide shot, establishing shot, medium shot, cowboy shot (mid-thigh up), medium close-up, close-up, extreme close-up, over-the-shoulder, POV (point of view), bird's-eye view, worm's-eye view.
Composition rules to invoke: rule of thirds, leading lines, negative space, symmetry, framing within frame, depth of field, foreground-middle-background layering.`
  },
  {
    title: "Weather & Environment Descriptors",
    tags: "weather, environment, atmosphere, vocabulary",
    content: `Weather is a powerful atmospheric tool. Specify it explicitly — it transforms the entire mood and lighting of a scene.
• Rain: 'heavy rain', 'light drizzle', 'rain-slicked streets with reflections', 'raindrops on a window'. Pairs with moody lighting and reflections.
• Fog / mist: 'thick fog', 'low morning mist', 'atmospheric haze'. Creates depth and mystery; use with volumetric light.
• Snow: 'gentle snowfall', 'heavy blizzard', 'snow-covered landscape'. Cool palette, soft diffused light.
• Wind: 'strong wind', 'gentle breeze'. Use to animate hair, foliage, fabric — adds life to static scenes.
• Storm: 'thunderstorm, lightning flash, dark storm clouds'. Dramatic, high-contrast.
• Clear sky: 'clear blue sky', 'scattered clouds', 'starry night sky'. Use for clarity and optimism.
• Dust / particles: 'floating dust particles in shafts of light', 'pollen drifting'. Adds texture and atmosphere.
Combo tip: 'rain at night with neon reflections' is one of the most cinematic combos the model handles well. 'Morning mist with golden-hour god rays' is another reliable winner.`
  },
  {
    title: "Quality Enhancement Phrases",
    tags: "quality, enhancement, booster, vocabulary",
    content: `These phrases act as global quality multipliers. Sprinkle 1-2 at the end of a prompt to push the model toward higher fidelity output. Overuse makes prompts feel spammy and can backfire.
• Detail: 'highly detailed', 'intricate detail', 'razor-sharp focus', 'fine texture detail'.
• Resolution: '8K', '4K', 'ultra HD', 'high resolution'. (These are aspirational cues, not actual output specs.)
• Photography: 'shot on 35mm film', 'shot on Hasselblad', 'professional photography', 'award-winning photograph'.
• Cinematic: 'cinematic', 'filmic', 'anamorphic', 'shot with shallow depth of field', 'cinematic color grade'.
• Lighting: 'dramatic lighting', 'soft natural light', 'studio lighting', 'professionally lit'.
• Render: 'octane render', 'unreal engine 5', 'ray-traced reflections', 'physically based rendering'. (For 3D-style prompts.)
• Composition: 'perfectly composed', 'masterfully framed', 'rule of thirds composition'.
Recommended set: Pick at most two: one detail/resolution phrase + one style/grade phrase.
Example: 'cinematic photorealistic style, shot on 35mm film, highly detailed, teal-orange color grade'.`
  },
  {
    title: "Common Pitfalls & Anti-Patterns",
    tags: "pitfalls, anti-pattern, avoid, quality",
    content: `Avoid these patterns — they consistently degrade Wan2.1 output quality.
• Multiple subjects in one prompt: 'A cat, a dog, and a bird playing together' produces blurry, confused output. Stick to ONE primary subject per prompt. Generate multiple videos and edit together.
• Abstract emotional directions: 'a video that feels happy and nostalgic' is too vague. Translate emotion into concrete visuals: 'children laughing on a sunlit playground, warm golden-hour light, slow-motion at 120fps'.
• Too many camera moves: 'pan left, then dolly in, then crane up, then orbit' confuses the model. Use ONE primary move, optionally combined with one secondary.
• Conflicting lighting: 'bright midday sun and moonlight' is contradictory. Pick one primary light source per shot.
• Over-specified faces: 'a woman who looks exactly like [celebrity]' — the model will produce distorted, uncanny results. Describe features instead: 'a woman with high cheekbones, dark shoulder-length hair, green eyes'.
• Text in frame: 'a sign reading HELLO' — Wan2.1 cannot reliably render legible text. Avoid prompts requiring specific written words.
• Extreme motion blur: 'everything is motion-blurred' — produces mush. Specify blur per element: 'water with motion blur, subject sharp'.
• Negation: 'no people in the scene' — the model often ignores negation. Describe what IS there, not what isn't.
• Prompt length over 80 words: diminishing returns; the model starts dropping earlier clauses. Keep prompts 30-60 words for best results.`
  },
  {
    title: "Abstract & Artistic Scene Template",
    tags: "abstract, artistic, template, experimental",
    content: `Abstract prompts work best with fluid materials, light, and motion rather than narrative subjects. Lead with the material, then the motion, then the light.
Template: [Material/element] + [Motion/force] + [Light interaction] + [Color palette] + [Style]
• Example — ink in water: Vivid magenta and teal ink dispersing through clear water, slow-motion at 120fps, backlit with a soft white light, swirling abstract patterns, macro lens, shallow depth of field.
• Example — light trails: Long-exposure light trails of cars on a highway at night, red and white streaks, hyperlapse, cinematic, desaturated background.
• Example — smoke: Wisps of white smoke rising against a black background, slow-motion, lit from the side, soft volumetric light, minimalist composition.
• Example — particles: Thousands of golden glowing particles swirling in a vortex, dark background, slow rotating camera, fantasy cinematic style.
Keywords for abstract quality: ethereal, fluid, iridescent, luminescent, organic, mesmerizing, hypnotic.`
  },
  {
    title: "Action & Sports Scene Template",
    tags: "action, sports, motion, template",
    content: `Action scenes need clear subject motion, camera that follows or counters, and motion blur on the right elements. Slow-motion is your friend here.
Template: [Athlete/subject] + [Specific action] + [Setting] + [Camera tracking move] + [Lighting] + [Motion blur note]
• Example — runner: A sprinter in a blue singlet exploding off the starting blocks, on an outdoor track at golden hour, tracking shot moving alongside at the same speed, slow-motion at 120fps, motion blur on the legs, shallow depth of field, cinematic.
• Example — surfer: A surfer carving through a glassy blue wave at sunset, water spraying in slow motion, low-angle tracking shot from the water, golden-hour backlight, motion blur on the spray.
• Example — skateboarder: A skateboarder mid-air during a kickflip, urban skatepark at dusk, low-angle shot from below, motion blur on the background, neon-lit, cinematic style.
Tip: Use 'tracking shot at the same speed as the subject' to keep the subject sharp while the background blurs — this is the signature action-film look.`
  },
  {
    title: "Fantasy & Sci-Fi Scene Template",
    tags: "fantasy, sci-fi, template, stylized",
    content: `Fantasy and sci-fi prompts lean on impossible scale, magical lighting, and stylized environments. Be specific about the impossible — generic 'magical' or 'futuristic' produces muddy results.
Template (fantasy): [Mythical subject/structure] + [Magical element] + [Impossible setting] + [Atmospheric light] + [Epic camera move] + [Painterly/cinematic style]
Template (sci-fi): [Futuristic subject/vehicle] + [Tech detail] + [Sci-fi setting] + [Artificial light source] + [Camera move] + [Hyperreal/cinematic style]
• Example — fantasy: A colossal ancient dragon with emerald scales perched on a mountain peak at dawn, breathing a thin stream of flame, vast misty valley below, slow aerial crane shot rising to reveal the dragon's full wingspan, golden-hour rim light, painterly cinematic style, epic scale.
• Example — sci-fi: A sleek silver spaceship descending through the clouds of a gas giant, glowing blue thrusters, ringed planet looming in the background, slow tracking shot following the ship, volumetric atmosphere, hyperreal cinematic style.
• Example — cityscape sci-fi: A towering cyberpunk megacity at night, holographic billboards in Japanese, flying cars streaking between skyscrapers, aerial drone shot descending through the canyons of buildings, neon-lit, anamorphic, blade-runner aesthetic.
Keywords: colossal, epic, ethereal, luminescent, ancient, futuristic, otherworldly, awe-inspiring.`
  },
  {
    title: "Wan2.1 Model Capabilities & Limitations",
    tags: "wan2.1, model, capabilities, limitations, technical",
    content: `Wan2.1-T2V-1.3B is a 1.3-billion-parameter text-to-video diffusion model. Understanding its strengths and limits produces dramatically better results.
Strengths:
• Single-subject scenes with clear, descriptive prompts (landscapes, portraits, objects).
• Slow, smooth camera movements — dolly, pan, tracking, crane.
• Atmospheric conditions — fog, rain, golden hour, neon light.
• Stylized aesthetics — cinematic, anime, 3D-render, painterly when explicitly named.
• Short clips (3-5 seconds) with a single coherent action.
Limitations:
• Multi-subject interaction (two people hugging, multiple animals playing) — produces blurring and fusion.
• Complex hand movements and fine finger articulation — often distorted.
• Legible text and specific written words — unreliable.
• Long continuous action beyond ~5 seconds — motion drifts and degrades.
• Specific celebrity or real-person likeness — uncanny, distorted results.
• Precise spatial reasoning ('object A is exactly 2 feet left of object B') — inconsistent.
• Fast cuts and montage within a single generation — generate each shot separately and edit.
Best practice: Generate one clean shot per prompt. For multi-shot sequences, run multiple generations and stitch them in post. Keep prompts to 30-60 words. Always specify camera movement, lighting, and style explicitly.`
  },
  {
    title: "Mood & Atmosphere Vocabulary Bank",
    tags: "mood, atmosphere, vocabulary, emotion",
    content: `Concrete mood words translate vague intent into visual language the model can render. Pair an emotional mood with the matching lighting, palette, and pacing for predictable tone.
• Serene / peaceful: calm, tranquil, still, soft, gentle, hushed. Pair with soft diffused light, pastel or muted palette, slow camera, real-time or slight slow motion.
• Dramatic / intense: powerful, sweeping, thunderous, charged, heightened. Pair with high-contrast lighting, bold palette, dynamic camera (crane, dolly-in).
• Mysterious / enigmatic: shadowy, obscured, veiled, cryptic, dim. Pair with low-key lighting, fog/haze, slow reveals, muted palette.
• Nostalgic / wistful: bygone, faded, sepia, longing, reminiscent. Pair with warm sepia grade, soft focus, golden-hour light, slow pacing.
• Energetic / vibrant: kinetic, electric, pulsing, vivid, dynamic. Pair with saturated palette, fast cuts, neon light, real-time motion.
• Melancholic / somber: lonely, quiet, muted, gray, pensive. Pair with overcast light, desaturated palette, static or slow camera, blue hour.
• Ethereal / dreamlike: floating, luminous, otherworldly, translucent, gossamer. Pair with backlight, soft focus, slow motion, pastel palette.
• Gritty / raw: harsh, unflinching, weathered, stark, unpolished. Pair with bleach-bypass grade, handheld camera, available light.
Tip: Never write 'make it feel [mood]' alone. Always follow with the visual translation: 'feel nostalgic — warm sepia grade, soft focus, golden-hour light, slow dolly-in'.`
  },
  {
    title: "Food & Product Scene Template",
    tags: "food, product, commercial, template",
    content: `Food and product shots need macro detail, controlled light, and subtle motion. The goal is mouthwatering or aspirational — every detail must signal craft.
Template: [Specific food/product] + [Setting/surface] + [Action detail] + [Macro camera move] + [Studio lighting] + [Hyperreal style]
• Example — coffee: A steaming cup of black coffee on a marble countertop, soft steam rising in slow motion, extreme close-up push-in on the cup, warm three-point studio lighting, shallow depth of field, hyperrealistic, professional commercial photography.
• Example — dessert: A slice of chocolate cake with a drizzle of caramel sauce being poured on top, on a rustic wooden board, macro shot, soft window light from the left, motion blur on the sauce, shallow depth of field, food-photography style.
• Example — product: A luxury perfume bottle on a reflective black surface, a single drop of water running down the glass, slow orbit around the bottle, dramatic side lighting, deep blacks, hyperreal commercial style.
Food quality boosters: 'glistening', 'freshly prepared', 'steam rising', 'drizzle of', 'golden crust', 'melted', 'crystalline', 'dewdrops'.`
  },
  {
    title: "Subject Description Best Practices",
    tags: "subject, description, people, animals, objects",
    content: `Subjects are the heart of every prompt. Vague subjects ('a man', 'a dog') produce generic output. Specific subjects produce memorable, controllable video.
For people, specify: age, hair (color, length, style), skin tone, distinctive feature, wardrobe (color, garment type), pose, gaze direction.
• Weak: 'a man walking'.
• Strong: 'a tall middle-aged man with short gray hair and a trimmed beard, wearing a charcoal overcoat, walking briskly with hands in pockets, gazing forward'.
For animals, specify: species, breed, color, age, distinctive feature, action, expression.
• Weak: 'a dog running'.
• Strong: 'a young golden retriever with a fluffy cream coat, ears flopping as it sprints across a grassy field, tongue out, joyful expression'.
For objects, specify: material, color, age/wear, distinctive detail, scale.
• Weak: 'a coffee cup'.
• Strong: 'a chipped white ceramic mug with a hairline crack, sitting on a worn wooden table'.
Tip: The first 10 words of your prompt carry the most weight — put the subject there. Style and camera come later.`
  }
];

async function seed() {
  for (const doc of docs) {
    try {
      const res = await fetch("http://localhost:3000/api/admin/rag", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": "wan2-admin-secret"
        },
        body: JSON.stringify(doc)
      });
      if (res.ok) {
        console.log("Created:", doc.title);
      } else {
        console.error("Failed:", doc.title, await res.text());
      }
    } catch (e) {
      console.error("Error:", e.message);
    }
  }
}
seed();
