from task_manager import rewrite_prompt_with_ollama

payload = '''---RAG_START---
USER_PROMPT:
A breathtaking, cinematic drone shot panning over a massive university campus where the academic buildings are built directly into the grandstands of a colossal football stadium. Modern glass lecture halls, a multi-story library, and student dorms with balconies face downward toward a pristine, neon-lit green turf field. Students in backpacks are walking along stadium concourses and sitting in stadium seats studying. Golden hour lighting, hyper-realistic architectural textures, 8k resolution, smooth camera movement, photorealistic.

RAG_RULES:
[Master Guide to High-Fidelity Video Prompt Detailing]
## Chapter 9: Expanded Matrix 1 ### Detailed Modifiers - Volumetric lighting, cinematic haze, dust particles, lens flares, optical glow. - Highly detailed textures, 8k resolution, photorealistic, hyper-detailed.
---RAG_END---'''

print("REWRITE:")
print(rewrite_prompt_with_ollama(payload))
