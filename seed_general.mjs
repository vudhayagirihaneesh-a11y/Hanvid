const docs = [
  {
    title: "General Video Quality",
    content: "Highly detailed, 8k resolution, photorealistic, masterpiece, vivid colors, crisp focus, dynamic lighting, professional cinematography. Subject is clear, well-lit, and anatomically correct.",
    tags: "create, video, person, general, default, flag, man, woman, quality"
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
