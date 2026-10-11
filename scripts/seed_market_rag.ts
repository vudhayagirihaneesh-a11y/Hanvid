import { db } from '../src/lib/db';

interface RagSeed {
  title: string;
  tags: string;
  content: string;
}

const ragSeeds: RagSeed[] = [
  {
    title: "Scientific Simulation & Physical Systems",
    tags: "physics, simulation, science, mechanics, pendulum, chaos, attractor, quantum, laboratory, magnetic, laser, optics, equations",
    content: `# Scientific Simulation & Mechanical Fidelity
## 1. Chaotic Dynamics & Articulated Pendulums
- To render a chaotic double pendulum accurately without confusing it with balance scales or clocks:
  * Specify: 'A tabletop mechanical double pendulum apparatus on a rigid black vertical post. Two linked CNC aluminum arms joined by a precision ball-bearing pivot linkage.'
  * Emphasize: 'As the lower arm swings in complex unpredictable chaotic orbits, its glowing neon cyan LED tip paints a continuous Strange Attractor curve in the air through long-exposure darkness.'
  * Negative guidance: Explicitly state 'No weighing scales, no hanging chains, no balance plates.'
## 2. Quantum & Superconductor Levitation (Meissner Effect)
  * Visual anchor: 'A frosted ceramic YBCO superconductor disc levitating and smoothly gliding in frictionless orbit 15mm above a circular neodymium magnet track.'
  * Environment: 'Swirling liquid nitrogen fog and cryogenic vapor condensing across a dark polished optical bench. Red laser alignment line reflecting off the metallic surface.'
## 3. Wave Optics & Laser Interferometry
  * Coherent laser beams (532nm green and 405nm violet) passing through beam-splitters and double slits.
  * Projects sharp concentric interference rings and Fourier transform patterns onto a matte projection screen. Clean optical glass mounts, volumetric laser haze.`
  },
  {
    title: "Architectural Integration & Multi-Scale Composition",
    tags: "architecture, building, campus, stadium, urban, city, drone, camera, scale, composition, exterior, interior",
    content: `# Complex Architectural Scenes & Scale Consistency
## 1. Hybrid Architecture Realism
- When combining complex concepts (e.g., campus buildings inside a stadium):
  * Do NOT use high-altitude aerial drone shots which default to generic sports arena bowls.
  * Use: 'A low-angle cinematic tracking shot moving along the tiered terraces of modern glass-walled university faculties integrated into architectural grandstands.'
  * Focus on visible architectural elements: 'Floor-to-ceiling curtain glass walls, exposed architectural concrete pillars, cantilevered balconies overlooking an illuminated turf field.'
## 2. Human Scale vs Landscape Scale
  * If students, pedestrians, or characters are part of the scene, position the camera at eye level (1.6m) or on a low Steadicam gimbal.
  * Describe specific interactions: 'Students with backpacks walking along illuminated concrete promenades, sitting at wooden exterior study benches with open laptops.'`
  },
  {
    title: "Ultra-Clean Cinematography & Anti-Distortion Standards",
    tags: "clean, quality, cinematic, 8k, sharp, crisp, lighting, arri, alexa, lens, photorealistic, noise, deflicker",
    content: `# Professional Clean Cinematography Guidelines
## 1. Optical Purity & Sharp Focus
- To achieve crystal-clear, distortion-free video output:
  * Camera specifiers: 'Shot on ARRI Alexa 65 with Panavision Primo anamorphic lenses, 8k resolution, raw color capture.'
  * Aperture & Bokeh: 'f/2.8 aperture, cinematic shallow depth of field, creamy spherical background bokeh, pin-sharp subject outlines.'
  * Lighting purity: 'Volumetric key lighting, subtle rim lighting, soft shadow falloff, realistic subsurface scattering, zero digital noise.'
## 2. Temporal Motion Stability
  * Pacing keywords: 'Smooth cinematic camera glide, fluid 24fps motion blur, perfectly stable camera track, zero jitter, zero frame morphing.'
  * Surface textures: 'High micro-contrast, physically accurate Fresnel reflections, crisp material textures (brushed steel, frosted glass, carbon fiber).'`
  },
  {
    title: "Character Realism, Anatomy & Organic Motion",
    tags: "character, human, person, face, skin, hands, portrait, walking, motion, photorealistic, crowd",
    content: `# Photorealistic Character & Humanoid Standards
## 1. Skin & Facial Fidelity
- To prevent plastic, waxy, or melted AI faces:
  * Specify: 'Natural skin pores, micro-facial expressions, natural eye glint, subtle subsurface scattering on cheekbones and ears.'
  * Eye & Lip clarity: 'Sharp in-focus eyes, realistic gaze tracking, natural resting lips, realistic individual hair strands reacting to subtle air movement.'
## 2. Natural Body Kinematics
  * Locomotion: 'Realistic weight-shift walking gait, natural swinging of arms, authentic clothing folds and textile tension reacting to gravity.'
  * Avoid crowd smears: 'Focus on 1 to 3 distinct foreground subjects rather than distant blurry masses.'`
  },
  {
    title: "Macro Physical Materials & Lighting Interaction",
    tags: "macro, material, glass, water, metallic, reflection, refraction, texture, close-up, physical",
    content: `# Macro Physics & Physically Based Rendering (PBR)
## 1. Transparent & Refractive Materials
- Glass and Liquids:
  * Obey Snell's law: 'Curved glass elements physically refract and invert background light with chromatic dispersion.'
  * Specular highlights: 'High-gloss pinpoint reflections tracking smoothly with camera orbit.'
## 2. Metals & Dynamic Fluids
  * Brushed metals: 'Anisotropic specular reflections on brushed aluminum and copper surfaces.'
  * Fluid dynamics: 'Discrete spherical droplets formed by surface tension, clear meniscus, zero unnatural vapor dissipation.'`
  }
];

async function main() {
  console.log("Seeding Market-Ready RAG Documents...");

  // Update existing Physics document with tags
  const existingPhysics = await db.ragDocument.findFirst({ where: { title: "Physics" } });
  if (existingPhysics) {
    await db.ragDocument.update({
      where: { id: existingPhysics.id },
      data: {
        tags: "physics, mechanics, science, quantum, laboratory, dynamics, fluid, optics, experiment, momentum, collisions"
      }
    });
    console.log("Updated tags on existing Physics document.");
  }

  for (const seed of ragSeeds) {
    const existing = await db.ragDocument.findFirst({ where: { title: seed.title } });
    if (existing) {
      await db.ragDocument.update({
        where: { id: existing.id },
        data: { tags: seed.tags, content: seed.content }
      });
      console.log(`Updated RAG Doc: ${seed.title}`);
    } else {
      await db.ragDocument.create({
        data: { title: seed.title, tags: seed.tags, content: seed.content }
      });
      console.log(`Created RAG Doc: ${seed.title}`);
    }
  }

  const count = await db.ragDocument.count();
  console.log(`Total RAG documents in database: ${count}`);
}

main().catch(err => {
  console.error("Error seeding RAG:", err);
  process.exit(1);
});
