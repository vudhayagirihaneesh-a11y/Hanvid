# Hanvid

Welcome to **Hanvid**, a blazing-fast, locally hosted Text-to-Video generation application. Powered by Wan2.1 and optimized for RTX GPUs, Hanvid combines a beautiful, responsive web interface with a high-performance Python inference server to bring your ideas to life in seconds.

![Hanvid Banner](https://via.placeholder.com/1200x400.png?text=Hanvid+-+Local+Text-to-Video)

## 🌟 Features

- **Blazing Fast Local Generation:** Optimized inference using the Wan2.1 model, capable of generating videos in ~2-3 minutes on an RTX 5070.
- **Beautiful Web Interface:** A sleek, modern Next.js frontend built with Tailwind CSS, Lucide icons, and Framer Motion for a seamless user experience.
- **RAG-Enhanced Prompting:** Automatically enhances user prompts with cinematic keywords, camera angles, and quality modifiers for stunning results.
- **Smart Queue Management:** A robust background task manager ensures sequential GPU usage, preventing out-of-memory crashes.
- **Full Chat History:** Keep track of all your prompts, generated videos, and conversations in a familiar chat-style interface.
- **Admin Dashboard:** Control system settings, manage RAG knowledge bases, and monitor the model server right from the web app.

## 🚀 Tech Stack

- **Frontend:** Next.js 15 (App Router), React, Tailwind CSS, Shadcn UI
- **Backend (Web):** Next.js API Routes, Prisma (SQLite/PostgreSQL)
- **Model Server:** Python, FastAPI, PyTorch, Diffusers
- **Model:** Wan2.1-T2V-1.3B-Diffusers

## 📋 Prerequisites

To run the model server locally, you need:
- Windows/Linux with Python 3.10+
- A CUDA-compatible NVIDIA GPU with at least 8GB VRAM (e.g., RTX 5070, RTX 3060, RTX 4060)
- Node.js 18+ for the web interface

## 🛠️ Installation & Setup

### 1. Web Application

Navigate to the project root and install dependencies:

```bash
npm install
```

Set up your database:

```bash
npx prisma generate
npx prisma db push
```

Start the development server:

```bash
npm run dev
```

The web app will be available at `http://localhost:3000`.

### 2. Model Server

Navigate to the `mini-services/model-service` directory:

```bash
cd mini-services/model-service
```

Create a virtual environment and install dependencies:

```bash
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

Start the inference server:

```bash
python server.py
```

The model server runs on `http://localhost:3004`. The first run will automatically download the required model weights from HuggingFace.

## ⚙️ Configuration

Hanvid can be configured using environment variables in the `.env` file (frontend) and via the Admin Dashboard.

### Model Server Options (Environment Variables)

- `WAN_MODEL_PATH`: Local path to Wan2.1 weights (if offline).
- `WAN_CACHE_THRESHOLD`: Controls First-Block Cache aggressiveness (default `0.05`). Higher means faster generation but lower quality.
- `WAN_NUM_FRAMES`: Number of frames to generate. Default is `81` (5 seconds).

## 🌍 Deployment

To deploy Hanvid to production (e.g., Vercel):

1. **Database:** Migrate your Prisma schema to use PostgreSQL (e.g., Supabase) instead of SQLite, as serverless environments cannot use local SQLite files.
2. **Model Server Exposure:** Use a tunneling service like [ngrok](https://ngrok.com/) to securely expose your local Python model server to the internet so the Vercel app can communicate with it.
3. **Environment Variables:** Update your Vercel project with the new `DATABASE_URL` and the ngrok URL for `MODEL_SERVER_URL`.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

This project is licensed under the MIT License.
