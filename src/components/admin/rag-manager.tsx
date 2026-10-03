"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api, RagDocument } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  Search,
  FileText,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

export function RagManager({ adminKey }: { adminKey: string }) {
  const [docs, setDocs] = useState<RagDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<RagDocument | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [initialData, setInitialData] = useState<{ title: string; content: string; tags: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (file.name.toLowerCase().endsWith(".pdf")) {
        const formData = new FormData();
        formData.append("file", file);
        
        const res = await fetch("/api/admin/rag/parse-pdf", {
          method: "POST",
          headers: {
            "x-admin-key": adminKey,
          },
          body: formData,
        });
        
        if (!res.ok) throw new Error("Failed to parse PDF");
        
        const data = await res.json();
        setInitialData({ title: file.name.replace(/\.pdf$/i, ""), content: data.text, tags: "pdf" });
        setCreating(true);
      } else {
        const text = await file.text();
        let title = file.name.replace(/\.md$/i, "");
        
        const firstLine = text.split('\n')[0];
        if (firstLine?.startsWith('# ')) {
          title = firstLine.replace(/^# /, '').trim();
        }

        setInitialData({ title, content: text, tags: "markdown" });
        setCreating(true);
      }
    } catch (err) {
      toast.error("Failed to read file");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { docs } = await api.admin.listRag(adminKey);
      setDocs(docs);
    } catch {
      toast.error("Failed to load RAG documents");
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = docs.filter(
    (d) =>
      d.title.toLowerCase().includes(query.toLowerCase()) ||
      d.content.toLowerCase().includes(query.toLowerCase()) ||
      d.tags.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-emerald-400" />
            Knowledge Base (RAG)
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Documents here are retrieved by relevance and used to enhance user
            prompts before video generation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="file"
            accept=".md,.pdf"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileUpload}
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
            <Upload className="w-4 h-4" />
            Upload File
          </Button>
          <Button onClick={() => { setInitialData(null); setCreating(true); }} className="gap-2">
            <Plus className="w-4 h-4" />
            Add Document
          </Button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents…"
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 rounded-xl border border-border/40 bg-muted/20 animate-pulse"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border/60 rounded-xl">
          <FileText className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {docs.length === 0
              ? "No knowledge documents yet. Add style guides, scene templates, or domain context."
              : "No documents match your search."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((doc) => (
            <div
              key={doc.id}
              className="group rounded-xl border border-border/60 bg-card/40 p-4 hover:border-emerald-500/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium truncate">{doc.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {doc.content}
                  </p>
                  {doc.tags && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {doc.tags
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean)
                        .map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="text-[11px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          >
                            {tag}
                          </Badge>
                        ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setEditing(doc)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmDelete(doc.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <RagDialog
        open={creating || !!editing}
        doc={editing}
        initialData={initialData}
        adminKey={adminKey}
        onClose={() => {
          setCreating(false);
          setEditing(null);
          setInitialData(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          setInitialData(null);
          refresh();
        }}
      />

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>
              It will no longer be used to enhance user prompts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!confirmDelete) return;
                try {
                  await api.admin.deleteRag(adminKey, confirmDelete);
                  toast.success("Document deleted");
                  refresh();
                } catch {
                  toast.error("Failed to delete document");
                }
                setConfirmDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RagDialog({
  open,
  doc,
  initialData,
  adminKey,
  onClose,
  onSaved,
}: {
  open: boolean;
  doc: RagDocument | null;
  initialData?: { title: string; content: string; tags: string } | null;
  adminKey: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (doc) {
        setTitle(doc.title);
        setContent(doc.content);
        setTags(doc.tags);
      } else if (initialData) {
        setTitle(initialData.title);
        setContent(initialData.content);
        setTags(initialData.tags);
      } else {
        setTitle("");
        setContent("");
        setTags("");
      }
    }
  }, [open, doc, initialData]);

  const save = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error("Title and content are required");
      return;
    }
    setSaving(true);
    try {
      if (doc) {
        await api.admin.updateRag(adminKey, doc.id, { title, content, tags });
        toast.success("Document updated");
      } else {
        await api.admin.createRag(adminKey, { title, content, tags });
        toast.success("Document added");
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{doc ? "Edit Document" : "Add Knowledge Document"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="rag-title">Title</Label>
            <Input
              id="rag-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Cinematic Style Guide"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rag-content">Content</Label>
            <Textarea
              id="rag-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Style guidance, scene templates, domain knowledge, camera angles, lighting notes…"
              className="min-h-[200px] resize-y"
            />
            <p className="text-xs text-muted-foreground">
              {content.length} / 20000 characters
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rag-tags">Tags (comma separated)</Label>
            <Input
              id="rag-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="cinematic, landscape, slow-motion"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : doc ? "Save Changes" : "Add Document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
