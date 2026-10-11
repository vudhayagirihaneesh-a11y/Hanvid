---
title: Negative Prompt Reference (Distortion Suppression)
tags: negative prompt, suppression, blur, distortion, anatomy, artifacts, watermark, quality control, safety, clean
---

# Negative Prompt Reference

The video service automatically injects an official Wan2.1 negative prompt that suppresses common failure modes. It targets:

- **Blur and softness**: blurry, out of focus, low resolution, smudged.
- **Structural deformation**: distorted face, extra limbs, deformed hands, bad anatomy, disfigured, morphing.
- **Artifacts**: jpeg artifacts, watermark, text, logo, signature, subtitles.
- **Composition errors**: cropped, worst quality, low quality, duplicate.

Important for distilled/rapid checkpoints: those models run WITHOUT the negative prompt (guidance 1.0), so keep the positive prompt strongly phrased — quality words like 'highly detailed, sharp focus' do the work instead.

Rules for your own prompts:

- Never write negations inside the positive prompt ('no blur', 'without hands') — models often generate exactly the negated thing.
- State the positive opposite instead: 'no blur' → 'razor-sharp focus'; 'not dark' → 'bright even lighting'.

This document drives the automatic cleanliness layer of the pipeline.
