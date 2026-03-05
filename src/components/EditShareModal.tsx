import { useState, useRef } from "react";
import { Lock, Upload, Images, Trash2, File } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { CodeEditor } from "./ui/CodeEditor";
import { ShareFormFields, computeExpiresAt } from "./ShareForm";
import { Spinner } from "./ui/Spinner";
import { useToast } from "./ui/Toast";
import {
  useShare, useUpdateLink, useUpdateMarkdown, useUpdateCode,
  useUpdateFile, useUpdateGallery, useUpdateGalleryImage,
  useDeleteGalleryImage, useAddGalleryImages, usePresignUpload,
} from "../api/hooks";
import type { ShareDetail } from "../api/hooks";

interface EditShareModalProps {
  open: boolean;
  onClose: () => void;
  shareId: string | null;
}

const LANGUAGES = [
  { value: "", label: "Auto-detect" },
  { value: "javascript", label: "JavaScript" }, { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" }, { value: "rust", label: "Rust" },
  { value: "go", label: "Go" }, { value: "java", label: "Java" },
  { value: "c", label: "C" }, { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" }, { value: "ruby", label: "Ruby" },
  { value: "php", label: "PHP" }, { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin" }, { value: "sql", label: "SQL" },
  { value: "html", label: "HTML" }, { value: "css", label: "CSS" },
  { value: "json", label: "JSON" }, { value: "yaml", label: "YAML" },
  { value: "toml", label: "TOML" }, { value: "bash", label: "Bash" },
  { value: "dockerfile", label: "Dockerfile" }, { value: "xml", label: "XML" },
  { value: "plaintext", label: "Plain Text" },
];

export function EditShareModal({ open, onClose, shareId }: EditShareModalProps) {
  const { data: share, isLoading } = useShare(open ? shareId : null);

  const typeLabels: Record<string, string> = {
    link: "Link", markdown: "Markdown", code: "Code Snippet", file: "File", gallery: "Gallery",
  };

  const title = share ? `Edit ${typeLabels[share.type] || "Share"}` : "Edit Share";
  const size = share?.type === "markdown" || share?.type === "code" ? "full"
    : share?.type === "gallery" ? "wide" : "default";
  const hasEditor = share?.type === "markdown" || share?.type === "code";

  return (
    <Modal open={open} onClose={onClose} title={title} size={size} dismissOnEscape={!hasEditor}>
      {isLoading || !share ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <>
          {share.type === "link" && <EditLinkForm share={share} onClose={onClose} />}
          {share.type === "markdown" && <EditMarkdownForm share={share} onClose={onClose} />}
          {share.type === "code" && <EditCodeForm share={share} onClose={onClose} />}
          {share.type === "file" && <EditFileForm share={share} onClose={onClose} />}
          {share.type === "gallery" && <EditGalleryForm share={share} onClose={onClose} />}
        </>
      )}
    </Modal>
  );
}

// Common edit fields hook
function useEditFields(share: ShareDetail) {
  const [title, setTitle] = useState(share.title || "");
  const [comment, setComment] = useState(share.comment || "");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxHits, setMaxHits] = useState(share.max_hits ? String(share.max_hits) : "");

  const formProps = {
    title, setTitle, comment, setComment,
    encrypted: false, setEncrypted: () => {},
    slugType: "short", setSlugType: () => {},
    customSlug: "", setCustomSlug: () => {},
    expiresAt, setExpiresAt, maxHits, setMaxHits,
  };

  const metadataPayload = () => {
    const data: Record<string, unknown> = {};
    data.title = title.trim() || null;
    data.comment = comment.trim() || null;
    const exp = computeExpiresAt(expiresAt);
    if (exp !== undefined) data.expires_at = exp;
    data.max_hits = maxHits ? parseInt(maxHits) : null;
    return data;
  };

  return { formProps, metadataPayload, currentExpiresAt: share.expires_at };
}

function EncryptedNotice() {
  return (
    <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-300 dark:border-yellow-800/50 rounded-lg text-sm text-yellow-800 dark:text-yellow-200">
      <Lock size={16} className="shrink-0" />
      Content is encrypted and cannot be edited. Metadata fields below are still editable.
    </div>
  );
}

// -- Link --
function EditLinkForm({ share, onClose }: { share: ShareDetail; onClose: () => void }) {
  const [url, setUrl] = useState(share.link?.url || "");
  const { formProps, metadataPayload, currentExpiresAt } = useEditFields(share);
  const update = useUpdateLink();
  const { toast } = useToast();

  const handleSubmit = () => {
    update.mutate(
      { id: share.id, url: url.trim(), ...metadataPayload() } as Parameters<typeof update.mutate>[0],
      {
        onSuccess: () => { toast("success", "Link updated!"); onClose(); },
        onError: (e) => toast("error", e.message),
      },
    );
  };

  return (
    <div className="space-y-4">
      <Input label="URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" type="url" />
      <ShareFormFields showEncrypt={false} showSlugType={false} currentExpiresAt={currentExpiresAt} {...formProps} />
      <Button onClick={handleSubmit} loading={update.isPending} className="w-full">Save Changes</Button>
    </div>
  );
}

// -- Markdown --
function EditMarkdownForm({ share, onClose }: { share: ShareDetail; onClose: () => void }) {
  const [content, setContent] = useState(share.markdown?.content || "");
  const { formProps, metadataPayload, currentExpiresAt } = useEditFields(share);
  const update = useUpdateMarkdown();
  const { toast } = useToast();
  const isEncrypted = !!share.encrypted;

  const handleSubmit = () => {
    const payload: Record<string, unknown> = { id: share.id, ...metadataPayload() };
    if (!isEncrypted) payload.content = content;
    update.mutate(payload as Parameters<typeof update.mutate>[0], {
      onSuccess: () => { toast("success", "Document updated!"); onClose(); },
      onError: (e) => toast("error", e.message),
    });
  };

  return (
    <div className="space-y-4">
      {isEncrypted ? (
        <EncryptedNotice />
      ) : (
        <div>
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Content</label>
          <CodeEditor value={content} onChange={setContent} language="markdown" placeholder="# Hello World" minHeight="350px" />
        </div>
      )}
      <ShareFormFields showEncrypt={false} showSlugType={false} currentExpiresAt={currentExpiresAt} {...formProps} />
      <Button onClick={handleSubmit} loading={update.isPending} className="w-full">Save Changes</Button>
    </div>
  );
}

// -- Code --
function EditCodeForm({ share, onClose }: { share: ShareDetail; onClose: () => void }) {
  const [content, setContent] = useState(share.code?.content || "");
  const [language, setLanguage] = useState(share.code?.language || "");
  const [filename, setFilename] = useState(share.code?.filename || "");
  const { formProps, metadataPayload, currentExpiresAt } = useEditFields(share);
  const update = useUpdateCode();
  const { toast } = useToast();
  const isEncrypted = !!share.encrypted;

  const handleSubmit = () => {
    const payload: Record<string, unknown> = { id: share.id, ...metadataPayload() };
    if (!isEncrypted) {
      payload.content = content;
      payload.language = language || undefined;
      payload.filename = filename.trim() || undefined;
    }
    update.mutate(payload as Parameters<typeof update.mutate>[0], {
      onSuccess: () => { toast("success", "Snippet updated!"); onClose(); },
      onError: (e) => toast("error", e.message),
    });
  };

  return (
    <div className="space-y-4">
      {isEncrypted ? (
        <EncryptedNotice />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} options={LANGUAGES} />
            <Input label="Filename" value={filename} onChange={(e) => setFilename(e.target.value)} placeholder="main.ts" />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Code</label>
            <CodeEditor key={language} value={content} onChange={setContent} language={language || "javascript"} placeholder="// paste your code here" minHeight="400px" />
          </div>
        </>
      )}
      <ShareFormFields showEncrypt={false} showSlugType={false} currentExpiresAt={currentExpiresAt} {...formProps} />
      <Button onClick={handleSubmit} loading={update.isPending} className="w-full">Save Changes</Button>
    </div>
  );
}

// -- File --
function EditFileForm({ share, onClose }: { share: ShareDetail; onClose: () => void }) {
  const { formProps, metadataPayload, currentExpiresAt } = useEditFields(share);
  const update = useUpdateFile();
  const { toast } = useToast();

  const handleSubmit = () => {
    update.mutate(
      { id: share.id, ...metadataPayload() } as Parameters<typeof update.mutate>[0],
      {
        onSuccess: () => { toast("success", "File share updated!"); onClose(); },
        onError: (e) => toast("error", e.message),
      },
    );
  };

  return (
    <div className="space-y-4">
      {share.file && (
        <div className="flex items-center gap-3 p-3 bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-800 rounded-lg">
          <File size={20} className="text-neutral-500" />
          <div>
            <div className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{share.file.filename}</div>
            <div className="text-xs text-neutral-500">{share.file.content_type} · {formatSize(share.file.size)}</div>
          </div>
        </div>
      )}
      <ShareFormFields showEncrypt={false} showSlugType={false} currentExpiresAt={currentExpiresAt} {...formProps} />
      <Button onClick={handleSubmit} loading={update.isPending} className="w-full">Save Changes</Button>
    </div>
  );
}

// -- Gallery --
function EditGalleryForm({ share, onClose }: { share: ShareDetail; onClose: () => void }) {
  const { formProps, metadataPayload, currentExpiresAt } = useEditFields(share);
  const updateGallery = useUpdateGallery();
  const updateImage = useUpdateGalleryImage();
  const deleteImage = useDeleteGalleryImage();
  const addImages = useAddGalleryImages();
  const presignUpload = usePresignUpload();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const isEncrypted = !!share.encrypted;

  const [images] = useState(share.images || []);
  const [captions, setCaptions] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    (share.images || []).forEach((img) => { map[img.id] = img.caption || ""; });
    return map;
  });
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const visibleImages = images.filter((img) => !deletedIds.has(img.id));

  const handleAddFiles = async (files: FileList) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    setUploading(true);
    try {
      const uploaded: Array<{ filename: string; content_type: string; size: number; r2_key: string }> = [];
      for (const file of imageFiles) {
        const { uploadId, r2Key } = await presignUpload.mutateAsync({
          filename: file.name, contentType: file.type, size: file.size,
        });
        const res = await fetch(`/api/upload/file/${uploadId}`, {
          method: "PUT", body: await file.arrayBuffer(), credentials: "same-origin",
        });
        if (!res.ok) throw new Error(`Failed to upload ${file.name}`);
        uploaded.push({ filename: file.name, content_type: file.type, size: file.size, r2_key: r2Key });
      }
      await addImages.mutateAsync({ shareId: share.id, images: uploaded });
      toast("success", `Added ${uploaded.length} image(s)`);
      // Re-fetch would be ideal but for now just close to refresh
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // 1. Update gallery metadata
      await updateGallery.mutateAsync({ id: share.id, ...metadataPayload() } as Parameters<typeof updateGallery.mutateAsync>[0]);

      // 2. Delete removed images
      for (const id of deletedIds) {
        await deleteImage.mutateAsync({ shareId: share.id, imageId: id });
      }

      // 3. Update changed captions
      for (const img of images) {
        if (deletedIds.has(img.id)) continue;
        const orig = img.caption || "";
        if (captions[img.id] !== orig) {
          await updateImage.mutateAsync({ shareId: share.id, imageId: img.id, caption: captions[img.id] });
        }
      }

      toast("success", "Gallery updated!");
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <ShareFormFields showEncrypt={false} showSlugType={false} currentExpiresAt={currentExpiresAt} {...formProps} />

      {!isEncrypted && (
        <>
          <div className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Images ({visibleImages.length})</h3>
              <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()} loading={uploading}>
                <Upload size={14} /> Add Images
              </Button>
              <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) handleAddFiles(e.target.files); }} />
            </div>

            {visibleImages.length > 0 ? (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {visibleImages.map((img) => (
                  <div key={img.id} className="flex items-center gap-3 p-2 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg">
                    <img src={`/s/${share.slug}/image/${img.id}`} alt={img.filename} className="w-16 h-12 object-cover rounded" />
                    <Input
                      value={captions[img.id] || ""}
                      onChange={(e) => setCaptions((prev) => ({ ...prev, [img.id]: e.target.value }))}
                      placeholder="Caption..."
                      className="flex-1"
                    />
                    <button
                      onClick={() => setDeletedIds((prev) => new Set(prev).add(img.id))}
                      className="p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500 hover:text-red-500"
                      title="Remove"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-neutral-500 text-sm">
                <Images size={24} className="mx-auto mb-2" />
                No images
              </div>
            )}
          </div>
        </>
      )}

      {isEncrypted && <EncryptedNotice />}

      <Button onClick={handleSave} loading={saving} className="w-full">Save Changes</Button>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
