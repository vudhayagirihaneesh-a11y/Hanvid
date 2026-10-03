"use client";

import { Chat, User } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, MessageSquare, Trash2, Film, LogOut } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function ChatSidebar({
  user,
  chats,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onLogout,
}: {
  user: User;
  chats: Chat[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onLogout: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <aside className="w-72 shrink-0 border-r border-border/60 bg-sidebar/40 backdrop-blur-xl flex flex-col h-full">
      {/* Brand */}
      <div className="px-4 h-14 flex items-center gap-2 border-b border-border/60">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
          <Film className="w-4 h-4 text-emerald-400" />
        </div>
        <span className="font-semibold tracking-tight">Hanvid</span>
      </div>

      {/* New chat */}
      <div className="p-3">
        <Button onClick={onNew} className="w-full justify-start gap-2" variant="default">
          <Plus className="w-4 h-4" />
          New Video Chat
        </Button>
      </div>

      {/* Chat list */}
      <ScrollArea className="flex-1 px-2">
        <div className="space-y-1 pb-2">
          {chats.length === 0 ? (
            <div className="text-center py-8 px-4">
              <MessageSquare className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">
                No chats yet. Create one to start generating videos.
              </p>
            </div>
          ) : (
            chats.map((chat) => (
              <div
                key={chat.id}
                className={`group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                  activeId === chat.id
                    ? "bg-emerald-500/10 border border-emerald-500/20"
                    : "hover:bg-muted/50 border border-transparent"
                }`}
                onClick={() => onSelect(chat.id)}
              >
                <MessageSquare
                  className={`w-4 h-4 shrink-0 ${
                    activeId === chat.id ? "text-emerald-400" : "text-muted-foreground"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{chat.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {chat._count?.messages ?? 0} messages
                  </p>
                </div>
                <button
                  className="shrink-0 transition-colors p-1.5 rounded-md text-red-500 hover:bg-destructive/10 hover:text-red-600 flex items-center justify-center opacity-100 bg-red-500/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(chat.id);
                  }}
                  title="Delete chat"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* User footer */}
      <div className="p-3 border-t border-border/60 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-sm font-semibold text-emerald-400">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{user.name}</p>
          <p className="text-[11px] text-muted-foreground">Local session</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={onLogout}
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </Button>
      </div>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the chat and all its generated videos. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDelete) onDelete(confirmDelete);
                setConfirmDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
