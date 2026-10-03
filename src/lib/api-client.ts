// Frontend API client for the WanVid app.

export interface User {
  id: string;
  name: string;
  createdAt: string;
  chats?: Chat[];
}

export interface Chat {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number };
  messages?: Message[];
}

export interface Video {
  id: string;
  messageId: string;
  status: "pending" | "generating" | "ready" | "failed";
  progress: number;
  url: string | null;
  source: string;
  errorMessage: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface Message {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  enhancedPrompt?: string | null;
  createdAt: string;
  video?: Video | null;
}

async function jfetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status} — ${text.slice(0, 200)}`);
    }
    throw new Error(`Invalid JSON response from ${url}`);
  }
  if (!res.ok) {
    throw new Error(data?.error || `Request failed: ${res.status}`);
  }
  return data as T;
}

// ---- User API ----
export const api = {
  createUser: (name: string) =>
    jfetch<{ user: User }>("/api/users", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  lookupUser: (name: string) =>
    jfetch<{ user: User | null }>(`/api/users?name=${encodeURIComponent(name)}`),

  getUser: (id: string) => jfetch<{ user: User }>(`/api/users?id=${id}`),

  // ---- Chat API ----
  listChats: (userId: string) =>
    jfetch<{ chats: Chat[] }>(`/api/chats?userId=${userId}`),

  createChat: (userId: string, title: string) =>
    jfetch<{ chat: Chat }>("/api/chats", {
      method: "POST",
      body: JSON.stringify({ userId, title }),
    }),

  getChat: (id: string) =>
    jfetch<{ chat: Chat & { messages: Message[]; user: User } }>(`/api/chats/${id}`),

  deleteChat: (id: string) =>
    jfetch<{ ok: boolean }>(`/api/chats/${id}`, { method: "DELETE" }),

  renameChat: (id: string, title: string) =>
    jfetch<{ chat: Chat }>(`/api/chats/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),

  // ---- Message API ----
  sendMessage: (chatId: string, content: string) =>
    jfetch<{ message: Message; video: Video; ragUsed: boolean }>(
      `/api/chats/${chatId}/messages`,
      { method: "POST", body: JSON.stringify({ content }) },
    ),

  // ---- Video API ----
  getVideo: (id: string) => jfetch<{ video: Video }>(`/api/videos/${id}`),

  retryVideo: (id: string) =>
    jfetch<{ video: Video }>(`/api/videos/${id}/retry`, { method: "POST" }),

  // ---- Waitlist / queue ----
  getQueue: () => jfetch<QueueStatus>("/api/queue"),

  // ---- Admin API ----
  admin: {
    stats: (key: string) =>
      jfetch<any>(`/api/admin/stats?key=${encodeURIComponent(key)}`),
    users: (key: string) =>
      jfetch<{ users: any[] }>(`/api/admin/users?key=${encodeURIComponent(key)}`),
    userChats: (key: string, userId: string) =>
      jfetch<{ user: User; chats: any[] }>(
        `/api/admin/users/${userId}/chats?key=${encodeURIComponent(key)}`,
      ),
    chatMessages: (key: string, chatId: string) =>
      jfetch<{ chat: any; messages: any[] }>(
        `/api/admin/chats/${chatId}/messages?key=${encodeURIComponent(key)}`,
      ),
    listRag: (key: string) =>
      jfetch<{ docs: RagDocument[] }>(
        `/api/admin/rag?key=${encodeURIComponent(key)}`,
      ),
    createRag: (key: string, data: { title: string; content: string; tags: string }) =>
      jfetch<{ doc: RagDocument }>(`/api/admin/rag?key=${encodeURIComponent(key)}`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateRag: (key: string, id: string, data: Partial<{ title: string; content: string; tags: string }>) =>
      jfetch<{ doc: RagDocument }>(`/api/admin/rag/${id}?key=${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    deleteRag: (key: string, id: string) =>
      jfetch<{ ok: boolean }>(`/api/admin/rag/${id}?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
      }),
  },
};

export interface RagDocument {
  id: string;
  title: string;
  content: string;
  tags: string;
  createdAt: string;
  updatedAt: string;
}

export interface QueueStatus {
  state: "ready" | "busy" | "warming" | "offline";
  waiting: number;
  waitSeconds: number;
  avgSeconds?: number;
}

// Local storage helpers for the user identity (no auth — name-based).
const USER_KEY = "wanvid_user";
export function getStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}
export function storeUser(user: User) {
  if (typeof window === "undefined") return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearStoredUser() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(USER_KEY);
}
