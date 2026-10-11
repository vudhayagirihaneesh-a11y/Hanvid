---
title: Wan2.1 Model Prompting Guide
tags: wan, wan2, model, prompt, guide, best practices, structure, english, five seconds, text to video
---

# Wan2.1 Prompting Best Practices

Rules that specifically fit the Wan2.1 text-to-video model used by this service:

- **Write in English**: Wan2.1 was trained on English captions. Translate the idea to English for the best adherence — the RAG rewriter does this automatically.
- **Be Concrete, Not Abstract**: 'a golden retriever catching a frisbee' renders; 'the feeling of freedom' does not. Abstract concepts cause chaotic, dream-like distortion.
- **One Scene, One Action**: The model generates ~5 seconds. One subject, one action, one setting. Multi-event prompts morph and glitch.
- **Describe Motion Simply**: 'walking slowly forward' beats 'cartwheeling rapidly while dodging debris'. Complex articulation breaks limb structure.
- **Subject First**: Lead with the subject: 'A young woman in a red jacket...' before environment or style.
- **Add Camera + Light**: Wan responds strongly to camera terms ('slow dolly in') and lighting terms ('golden hour backlight').
- **Avoid Text In Video**: Do not ask for readable signs or captions — generated text comes out garbled.
- **Positive Phrasing Only**: Say what you WANT ('sharp focus'), never what you don't ('no blur') — negations in the prompt often summon the very artifact you are avoiding.

These rules are applied automatically when the RAG knowledge base is connected.
