"use client";

import { useEffect, useState, useCallback } from "react";
import { api, User } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Users,
  MessageSquare,
  Film,
  Database,
  ArrowLeft,
  ChevronRight,
  Eye,
  Clock,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

interface AdminUser {
  id: string;
  name: string;
  createdAt: string;
  chatCount: number;
  messageCount: number;
}

interface Stats {
  userCount: number;
  chatCount: number;
  messageCount: number;
  videoCount: number;
  readyVideos: number;
  ragCount: number;
}

export function AdminMonitor({ adminKey }: { adminKey: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<{
    user: User;
    chats: any[];
  } | null>(null);
  const [selectedChat, setSelectedChat] = useState<{
    chat: any;
    messages: any[];
  } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, u] = await Promise.all([
        api.admin.stats(adminKey),
        api.admin.users(adminKey),
      ]);
      setStats(s);
      setUsers(u.users);
    } catch {
      toast.error("Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openUser = async (userId: string) => {
    try {
      const { user, chats } = await api.admin.userChats(adminKey, userId);
      setSelectedUser({ user, chats });
    } catch {
      toast.error("Failed to load user chats");
    }
  };

  const openChat = async (chatId: string) => {
    try {
      const { chat, messages } = await api.admin.chatMessages(adminKey, chatId);
      setSelectedChat({ chat, messages });
    } catch {
      toast.error("Failed to load chat messages");
    }
  };

  const deleteUser = async (userId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this user and all their data?")) return;
    try {
      await api.admin.deleteUser(adminKey, userId);
      toast.success("User deleted");
      refresh();
      if (selectedUser?.user.id === userId) setSelectedUser(null);
    } catch {
      toast.error("Failed to delete user");
    }
  };

  const deleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this chat?")) return;
    try {
      await api.admin.deleteChat(adminKey, chatId);
      toast.success("Chat deleted");
      if (selectedUser) openUser(selectedUser.user.id);
      refresh();
    } catch {
      toast.error("Failed to delete chat");
    }
  };

  const statCards = [
    { label: "Users", value: stats?.userCount ?? 0, icon: Users, color: "text-emerald-400" },
    { label: "Chats", value: stats?.chatCount ?? 0, icon: MessageSquare, color: "text-teal-400" },
    { label: "Prompts", value: stats?.messageCount ?? 0, icon: MessageSquare, color: "text-cyan-400" },
    { label: "Videos", value: stats?.videoCount ?? 0, icon: Film, color: "text-amber-400" },
    { label: "Ready", value: stats?.readyVideos ?? 0, icon: Film, color: "text-lime-400" },
    { label: "RAG Docs", value: stats?.ragCount ?? 0, icon: Database, color: "text-fuchsia-400" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Eye className="w-5 h-5 text-emerald-400" />
          Monitoring
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Track usage across all users. Prompt text is visible for moderation;
          generated videos are intentionally hidden.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-border/60 bg-card/40 p-4"
          >
            <s.icon className={`w-5 h-5 mb-2 ${s.color}`} />
            <div className="text-2xl font-bold tabular-nums">
              {loading ? "—" : s.value}
            </div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Users table */}
      <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
          <h3 className="font-medium">Users</h3>
          <Badge variant="secondary">{users.length} total</Badge>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No users yet.
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="divide-y divide-border/40">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  <button
                    onClick={() => openUser(u.id)}
                    className="flex-1 flex items-center gap-3 text-left min-w-0"
                  >
                    <div className="w-9 h-9 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-sm font-semibold text-emerald-400 shrink-0">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{u.name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(u.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mr-2">
                      <span className="text-center">
                        <span className="block font-semibold text-foreground tabular-nums">
                          {u.chatCount}
                        </span>
                        chats
                      </span>
                      <span className="text-center">
                        <span className="block font-semibold text-foreground tabular-nums">
                          {u.messageCount}
                        </span>
                        prompts
                      </span>
                    </div>
                  </button>
                  <Button variant="ghost" size="icon" onClick={(e) => deleteUser(u.id, e)} className="shrink-0 text-muted-foreground hover:text-destructive h-8 w-8">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 pointer-events-none" />
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* User chats dialog */}
      <Dialog open={!!selectedUser} onOpenChange={(o) => !o && setSelectedUser(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeft
                className="w-4 h-4 cursor-pointer text-muted-foreground hover:text-foreground"
                onClick={() => setSelectedUser(null)}
              />
              {selectedUser?.user.name}&apos;s Chats
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="space-y-2 pb-4">
              {selectedUser?.chats.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  This user has no chats yet.
                </p>
              )}
              {selectedUser?.chats.map((chat: any) => (
                <div
                  key={chat.id}
                  className="w-full flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 p-2 hover:border-emerald-500/30 transition-colors"
                >
                  <button
                    onClick={() => openChat(chat.id)}
                    className="flex-1 text-left min-w-0 p-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium truncate flex-1">{chat.title}</p>
                      <Badge variant="secondary" className="shrink-0">
                        {chat._count?.messages ?? 0} msgs
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(chat.updatedAt).toLocaleString()}
                    </p>
                  </button>
                  <Button variant="ghost" size="icon" onClick={(e) => deleteChat(chat.id, e)} className="shrink-0 text-muted-foreground hover:text-destructive h-8 w-8 mr-1">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Chat messages dialog (prompts only — no videos) */}
      <Dialog open={!!selectedChat} onOpenChange={(o) => !o && setSelectedChat(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeft
                className="w-4 h-4 cursor-pointer text-muted-foreground hover:text-foreground"
                onClick={() => setSelectedChat(null)}
              />
              {selectedChat?.chat.title}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="space-y-3 pb-4">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300/80 flex items-center gap-2">
                <Eye className="w-3.5 h-3.5 shrink-0" />
                Admin view shows prompt text and generation status only. Video
                files are hidden.
              </div>
              {selectedChat?.messages.map((m: any) => (
                <div
                  key={m.id}
                  className={`rounded-lg p-3 border ${
                    m.role === "user"
                      ? "bg-emerald-500/5 border-emerald-500/20"
                      : "bg-muted/30 border-border/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <Badge
                      variant="secondary"
                      className={
                        m.role === "user"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      }
                    >
                      {m.role === "user" ? "User prompt" : "Assistant"}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(m.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {m.content}
                  </p>
                  {m.enhancedPrompt && (
                    <p className="text-xs text-muted-foreground mt-2 italic border-t border-border/40 pt-2">
                      <span className="font-medium not-italic text-foreground/70">
                        Enhanced:
                      </span>{" "}
                      {m.enhancedPrompt}
                    </p>
                  )}
                  {m.video && (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <Badge
                        variant="outline"
                        className={
                          m.video.status === "ready"
                            ? "border-lime-500/30 text-lime-400"
                            : m.video.status === "failed"
                              ? "border-rose-500/30 text-rose-400"
                              : "border-amber-500/30 text-amber-400"
                        }
                      >
                        {m.video.status}
                      </Badge>
                      {m.video.source && (
                        <span className="text-muted-foreground">
                          via {m.video.source}
                        </span>
                      )}
                      {m.video.errorMessage && (
                        <span className="text-rose-400/80 truncate">
                          {m.video.errorMessage}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {selectedChat?.messages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No messages in this chat.
                </p>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
