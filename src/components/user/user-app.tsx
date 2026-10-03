"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  api,
  User,
  Chat,
  Message,
  getStoredUser,
  clearStoredUser,
} from "@/lib/api-client";
import { NameScreen } from "./name-screen";
import { ChatSidebar } from "./chat-sidebar";
import { PromptInput } from "./prompt-input";
import { VideoCard } from "./video-card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Film, Sparkles, Loader2, Menu, X } from "lucide-react";
import { toast } from "sonner";

export function UserApp() {
  const [user, setUser] = useState<User | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<
    (Chat & { messages: Message[]; user: User }) | null
  >(null);
  const [loadingChats, setLoadingChats] = useState(false);
  const [sending, setSending] = useState(false);
  const [booting, setBooting] = useState(true);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Restore user from localStorage on mount.
  useEffect(() => {
    const stored = getStoredUser();
    if (stored) setUser(stored);
    setBooting(false);
  }, []);

  // Load chats whenever the user changes.
  const refreshChats = useCallback(async () => {
    if (!user) return;
    setLoadingChats(true);
    try {
      const { chats } = await api.listChats(user.id);
      setChats(chats);
    } catch (err) {
      toast.error("Failed to load chats");
    } finally {
      setLoadingChats(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) refreshChats();
  }, [user, refreshChats]);

  const loadChat = useCallback(async (id: string) => {
    try {
      const { chat } = await api.getChat(id);
      setActiveChat(chat);
    } catch {
      toast.error("Failed to load chat");
    }
  }, []);

  const handleNewChat = useCallback(async () => {
    if (!user) return;
    try {
      const { chat } = await api.createChat(user.id, "New Video Chat");
      setChats((prev) => [chat, ...prev]);
      setActiveChat({
        ...chat,
        messages: [],
        user,
      });
    } catch {
      toast.error("Failed to create chat");
    }
  }, [user]);

  const handleDeleteChat = useCallback(
    async (id: string) => {
      try {
        await api.deleteChat(id);
        setChats((prev) => prev.filter((c) => c.id !== id));
        if (activeChat?.id === id) setActiveChat(null);
        toast.success("Chat deleted");
      } catch {
        toast.error("Failed to delete chat");
      }
    },
    [activeChat],
  );

  const handleSend = useCallback(
    async (content: string) => {
      if (!activeChat || !user) return;
      setSending(true);

      // Optimistic: append the user message + a placeholder assistant message/video.
      const optimisticUserMsg: Message = {
        id: `tmp-${Date.now()}`,
        chatId: activeChat.id,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };
      const optimisticAssistantMsg: Message = {
        id: `tmp-a-${Date.now()}`,
        chatId: activeChat.id,
        role: "assistant",
        content: "Generating video…",
        createdAt: new Date().toISOString(),
        video: {
          id: `tmp-v-${Date.now()}`,
          messageId: `tmp-a-${Date.now()}`,
          status: "pending",
          progress: 0,
          url: null,
          source: "auto",
          errorMessage: null,
          duration: null,
          width: null,
          height: null,
          createdAt: new Date().toISOString(),
        },
      };
      setActiveChat((prev) =>
        prev
          ? {
              ...prev,
              messages: [...prev.messages, optimisticUserMsg, optimisticAssistantMsg],
            }
          : prev,
      );

      try {
        const { message, video, ragUsed } = await api.sendMessage(activeChat.id, content);
        // Replace the optimistic assistant message with the real one.
        setActiveChat((prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.map((m) =>
                  m.id === optimisticAssistantMsg.id
                    ? { ...message, video }
                    : m,
                ),
              }
            : prev,
        );
        if (ragUsed) {
          toast.info("Prompt enhanced with knowledge base", {
            description: "Admin-provided context was applied to your prompt.",
          });
        }
        // Refresh chat list to update message counts and the auto-title.
        refreshChats();
        api
          .getChat(activeChat.id)
          .then(({ chat }) =>
            setActiveChat((prev) =>
              prev && prev.id === chat.id ? { ...prev, title: chat.title } : prev,
            ),
          )
          .catch(() => {});
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to send message");
        // Remove optimistic messages on failure.
        setActiveChat((prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.filter(
                  (m) =>
                    m.id !== optimisticUserMsg.id &&
                    m.id !== optimisticAssistantMsg.id,
                ),
              }
            : prev,
        );
      } finally {
        setSending(false);
      }
    },
    [activeChat, user, refreshChats],
  );

  const handleLogout = useCallback(() => {
    clearStoredUser();
    setUser(null);
    setChats([]);
    setActiveChat(null);
  }, []);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages.length]);

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <NameScreen onReady={setUser} />;
  }

  const handleSelectChat = (id: string) => {
    loadChat(id);
    setMobileSidebar(false);
  };
  const handleNewChatMobile = () => {
    handleNewChat();
    setMobileSidebar(false);
  };

  return (
    <div className="h-screen flex bg-background bg-grid relative">
      {/* Desktop sidebar */}
      <div className="hidden sm:flex">
        <ChatSidebar
          user={user}
          chats={chats}
          activeId={activeChat?.id ?? null}
          onSelect={loadChat}
          onNew={handleNewChat}
          onDelete={handleDeleteChat}
          onLogout={handleLogout}
        />
      </div>

      {/* Mobile sidebar drawer */}
      {mobileSidebar && (
        <div className="sm:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileSidebar(false)}
          />
          <div className="relative z-10">
            <ChatSidebar
              user={user}
              chats={chats}
              activeId={activeChat?.id ?? null}
              onSelect={handleSelectChat}
              onNew={handleNewChatMobile}
              onDelete={handleDeleteChat}
              onLogout={handleLogout}
            />
          </div>
          <button
            className="absolute top-4 right-4 z-20 p-2 rounded-lg bg-background/80 backdrop-blur border border-border"
            onClick={() => setMobileSidebar(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Main chat area */}
      <main className="flex-1 flex flex-col min-w-0">
        {activeChat ? (
          <>
            <header className="h-14 border-b border-border/60 flex items-center px-4 gap-3 bg-background/80 backdrop-blur-xl">
              <button
                className="sm:hidden p-2 -ml-2 rounded-lg hover:bg-muted"
                onClick={() => setMobileSidebar(true)}
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold truncate">{activeChat.title}</h2>
                <p className="text-[11px] text-muted-foreground">
                  {activeChat.messages.length} messages
                </p>
              </div>
              <Button variant="ghost" size="sm" className="gap-2" onClick={handleNewChat}>
                <Plus className="w-4 h-4" />
                New
              </Button>
            </header>

            <ScrollArea className="flex-1">
              <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
                {activeChat.messages.length === 0 && (
                  <div className="text-center py-16 space-y-4">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto">
                      <Film className="w-8 h-8 text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Start creating</h3>
                      <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                        Describe a scene below and Hanvid will generate a video for you.
                        Keep chatting to refine or build on your ideas.
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2 pt-2">
                      {[
                        "A serene mountain lake at sunrise, mist rising off the water",
                        "Neon city street in the rain, reflections on wet pavement",
                        "A cat playing with a ball of yarn in slow motion",
                      ].map((s) => (
                        <button
                          key={s}
                          onClick={() => handleSend(s)}
                          disabled={sending}
                          className="text-xs px-3 py-1.5 rounded-full border border-border/60 bg-card/40 hover:bg-emerald-500/10 hover:border-emerald-500/30 transition-colors text-muted-foreground hover:text-emerald-300"
                        >
                          {s.length > 40 ? s.slice(0, 40) + "…" : s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {activeChat.messages.map((m) =>
                  m.role === "user" ? (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-emerald-500/15 border border-emerald-500/20 px-4 py-2.5">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {m.content}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="flex justify-start">
                      <div className="max-w-[85%] space-y-2">
                        {m.video ? (
                          <VideoCard
                            video={m.video}
                            message={m}
                            chatId={activeChat.id}
                          />
                        ) : (
                          <div className="rounded-2xl rounded-bl-md bg-muted/40 border border-border/40 px-4 py-2.5">
                            <p className="text-sm leading-relaxed text-muted-foreground">
                              {m.content}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ),
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <PromptInput onSend={handleSend} disabled={sending} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-cinematic relative">
            <button
              className="sm:hidden absolute top-4 left-4 p-2 rounded-lg bg-background/80 backdrop-blur border border-border"
              onClick={() => setMobileSidebar(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-center space-y-4 max-w-md px-6">
              <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto relative">
                <Sparkles className="w-10 h-10 text-emerald-400" />
                <div className="absolute inset-0 blur-2xl bg-emerald-500/20 animate-pulse-glow" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight">
                  Welcome to Hanvid Studio
                </h2>
                <p className="text-muted-foreground mt-2">
                  Create a new chat to start generating videos from text prompts.
                </p>
              </div>
              <Button onClick={handleNewChat} size="lg" className="gap-2">
                <Plus className="w-4 h-4" />
                Start a new video chat
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
