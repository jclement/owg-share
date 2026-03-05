import { useState } from "react";
import {
  Link as LinkIcon, FileText, Code as CodeIcon, Upload, Images,
  ArrowLeft, HelpCircle,
} from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { CodeEditor } from "./ui/CodeEditor";
import { ShareFormFields, computeExpiresAt } from "./ShareForm";
import { ShareResult } from "./ShareResult";
import { useToast } from "./ui/Toast";
import {
  useCreateLink, useCreateMarkdown, useCreateCode, useCreateFile,
  useCreateGallery, usePresignUpload,
} from "../api/hooks";
import { multipartUpload, MULTIPART_THRESHOLD } from "../api/client";
import {
  encryptText, encryptFile, generateEncryptionKey, exportKey,
} from "../lib/crypto";
import { useRef } from "react";

interface NewShareWizardProps {
  open: boolean;
  onClose: () => void;
}

type ShareTypeOption = "link" | "markdown" | "code" | "file" | "gallery";

const SHARE_TYPES: Array<{
  type: ShareTypeOption;
  label: string;
  description: string;
  icon: typeof LinkIcon;
  color: string;
}> = [
  { type: "link", label: "Link", description: "Shortened URL redirect", icon: LinkIcon, color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  { type: "markdown", label: "Markdown", description: "Rich document with formatting", icon: FileText, color: "text-green-400 bg-green-500/10 border-green-500/20" },
  { type: "code", label: "Code", description: "Syntax-highlighted snippet", icon: CodeIcon, color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20" },
  { type: "file", label: "File", description: "Upload any file", icon: Upload, color: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
  { type: "gallery", label: "Gallery", description: "Image gallery with lightbox", icon: Images, color: "text-pink-400 bg-pink-500/10 border-pink-500/20" },
];

export function NewShareWizard({ open, onClose }: NewShareWizardProps) {
  const [selectedType, setSelectedType] = useState<ShareTypeOption | null>(null);
  const [result, setResult] = useState<{ slug: string; encrypted: boolean; key?: string } | null>(null);

  const handleClose = () => {
    setSelectedType(null);
    setResult(null);
    onClose();
  };

  const handleResult = (r: { slug: string; encrypted: boolean; key?: string }) => {
    setResult(r);
  };

  const handleDone = () => {
    setSelectedType(null);
    setResult(null);
  };

  const title = result
    ? "Share Created"
    : selectedType
      ? `New ${SHARE_TYPES.find((t) => t.type === selectedType)?.label}`
      : "New Share";

  const needsWideModal = selectedType === "markdown" || selectedType === "code";

  return (
    <Modal open={open} onClose={handleClose} title={title} size={needsWideModal ? "full" : "default"}>
      {result ? (
        <ShareResult
          slug={result.slug}
          encrypted={result.encrypted}
          encryptionKey={result.key}
          onDone={handleDone}
        />
      ) : !selectedType ? (
        <TypePicker onSelect={setSelectedType} />
      ) : (
        <div>
          <button
            onClick={() => setSelectedType(null)}
            className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 mb-4 transition-colors"
          >
            <ArrowLeft size={14} /> Back to types
          </button>
          {selectedType === "link" && <LinkForm onResult={handleResult} />}
          {selectedType === "markdown" && <MarkdownForm onResult={handleResult} />}
          {selectedType === "code" && <CodeForm onResult={handleResult} />}
          {selectedType === "file" && <FileForm onResult={handleResult} />}
          {selectedType === "gallery" && <GalleryForm onResult={handleResult} />}
        </div>
      )}
    </Modal>
  );
}

function TypePicker({ onSelect }: { onSelect: (type: ShareTypeOption) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-neutral-500 mb-4">What do you want to share?</p>
      {SHARE_TYPES.map((st) => (
        <button
          key={st.type}
          onClick={() => onSelect(st.type)}
          className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-all hover:scale-[1.01] ${st.color}`}
        >
          <st.icon size={24} />
          <div className="text-left">
            <div className="font-medium text-neutral-900 dark:text-neutral-100">{st.label}</div>
            <div className="text-sm text-neutral-500 dark:text-neutral-400">{st.description}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

// -- Shared form hook for common fields --
function useCommonFields() {
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [encrypted, setEncrypted] = useState(false);
  const [slugType, setSlugType] = useState("short");
  const [customSlug, setCustomSlug] = useState("");
  const [expiresAt, setExpiresAt] = useState("90d");
  const [maxHits, setMaxHits] = useState("");

  const formProps = {
    title, setTitle, comment, setComment, encrypted, setEncrypted,
    slugType, setSlugType, customSlug, setCustomSlug,
    expiresAt, setExpiresAt, maxHits, setMaxHits,
  };

  const commonData = () => ({
    title: title.trim() || undefined,
    comment: comment.trim() || undefined,
    slug_type: encrypted ? "encrypted" : slugType,
    custom_slug: slugType === "custom" ? customSlug : undefined,
    expires_at: computeExpiresAt(expiresAt),
    max_hits: maxHits ? parseInt(maxHits) : undefined,
  });

  return { formProps, commonData, encrypted };
}

// -- Link Form --
function LinkForm({ onResult }: { onResult: (r: { slug: string; encrypted: boolean; key?: string }) => void }) {
  const [url, setUrl] = useState("");
  const { formProps, commonData } = useCommonFields();
  const createLink = useCreateLink();
  const { toast } = useToast();

  const handleSubmit = () => {
    if (!url.trim()) { toast("error", "URL is required"); return; }
    createLink.mutate(
      { url: url.trim(), ...commonData() },
      {
        onSuccess: (data) => { onResult({ slug: data.slug, encrypted: false }); toast("success", "Link created!"); },
        onError: (e) => toast("error", e.message),
      }
    );
  };

  return (
    <div className="space-y-4">
      <Input label="URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" autoFocus type="url" />
      <ShareFormFields showEncrypt={false} {...formProps} />
      <Button onClick={handleSubmit} loading={createLink.isPending} className="w-full">Create Link</Button>
    </div>
  );
}

// -- Markdown Form --
function MarkdownForm({ onResult }: { onResult: (r: { slug: string; encrypted: boolean; key?: string }) => void }) {
  const [content, setContent] = useState("");
  const { formProps, commonData, encrypted } = useCommonFields();
  const createMarkdown = useCreateMarkdown();
  const { toast } = useToast();

  // Default slug type to long for markdown
  if (formProps.slugType === "short") formProps.setSlugType("long");

  const handleSubmit = async () => {
    if (!content.trim()) { toast("error", "Content is required"); return; }

    let finalContent = content;
    let encryptionKeyStr: string | undefined;

    if (encrypted) {
      const key = await generateEncryptionKey();
      encryptionKeyStr = await exportKey(key);
      finalContent = await encryptText(content, key);
    }

    createMarkdown.mutate(
      { content: finalContent, encrypted, ...commonData() },
      {
        onSuccess: (data) => { onResult({ slug: data.slug, encrypted: data.encrypted, key: encryptionKeyStr }); toast("success", "Document created!"); },
        onError: (e) => toast("error", e.message),
      }
    );
  };

  const [showSyntaxGuide, setShowSyntaxGuide] = useState(false);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">Content</label>
          <button
            type="button"
            onClick={() => setShowSyntaxGuide(true)}
            className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
          >
            <HelpCircle size={14} /> Syntax Guide
          </button>
        </div>
        <CodeEditor
          value={content}
          onChange={setContent}
          language="markdown"
          placeholder="# Hello World\n\nWrite your markdown here..."
          minHeight="350px"
        />
      </div>
      <ShareFormFields {...formProps} />
      <Button onClick={handleSubmit} loading={createMarkdown.isPending} className="w-full">Create Document</Button>
      <MarkdownSyntaxGuide open={showSyntaxGuide} onClose={() => setShowSyntaxGuide(false)} />
    </div>
  );
}

function MarkdownSyntaxGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Markdown Syntax Guide" size="wide">
      <div className="space-y-6 text-sm text-neutral-700 dark:text-neutral-300">
        <Section title="Basic Formatting">
          <Row syntax="**bold**" result="bold" />
          <Row syntax="*italic*" result="italic" />
          <Row syntax="~~strikethrough~~" result="strikethrough" />
          <Row syntax="`inline code`" result="inline code" />
          <Row syntax="[link text](url)" result="link" />
          <Row syntax="![alt](image-url)" result="image" />
        </Section>

        <Section title="Headings">
          <Code>{`# Heading 1\n## Heading 2\n### Heading 3`}</Code>
        </Section>

        <Section title="Lists">
          <Code>{`- Unordered item\n- Another item\n  - Nested item\n\n1. Ordered item\n2. Another item`}</Code>
        </Section>

        <Section title="Code Blocks">
          <Code>{`\`\`\`javascript\nconst x = 42;\nconsole.log(x);\n\`\`\``}</Code>
          <p className="text-xs text-neutral-500 mt-1">Supports syntax highlighting for most languages.</p>
        </Section>

        <Section title="Tables">
          <Code>{`| Header | Header |\n|--------|--------|\n| Cell   | Cell   |\n| Cell   | Cell   |`}</Code>
        </Section>

        <Section title="Blockquotes">
          <Code>{`> This is a blockquote\n> with multiple lines`}</Code>
        </Section>

        <Section title="Horizontal Rule">
          <Code>---</Code>
        </Section>

        <Section title="Task Lists">
          <Code>{`- [ ] Unchecked\n- [x] Checked`}</Code>
        </Section>

        <Section title="Callouts">
          <p className="text-xs text-neutral-500 mb-2">
            Obsidian-style callouts using blockquote syntax. Supported types:
          </p>
          <Code>{`> [!info] Title\n> Callout body text here.\n\n> [!warning] Be careful\n> This is a warning callout.\n\n> [!tip]\n> Title is optional.`}</Code>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {["info", "tip", "warning", "danger", "caution", "note", "abstract", "summary", "success", "question", "failure", "bug", "example", "quote"].map((type) => (
              <span key={type} className="px-2 py-0.5 text-xs rounded bg-neutral-100 dark:bg-neutral-800 font-mono">
                {type}
              </span>
            ))}
          </div>
        </Section>

        <Section title="Mermaid Diagrams">
          <Code>{`\`\`\`mermaid\ngraph LR\n  A --> B --> C\n\`\`\``}</Code>
          <p className="text-xs text-neutral-500 mt-1">Renders flowcharts, sequence diagrams, and more.</p>
        </Section>

        <Section title="Math (LaTeX)">
          <Code>{`Inline: $E = mc^2$\n\nBlock:\n$$\n\\sum_{i=1}^{n} x_i\n$$`}</Code>
        </Section>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Row({ syntax, result }: { syntax: string; result: string }) {
  return (
    <div className="flex items-center gap-3 py-0.5">
      <code className="text-xs font-mono bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded">{syntax}</code>
      <span className="text-xs text-neutral-500">&rarr;</span>
      <span className="text-xs">{result}</span>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="text-xs font-mono bg-neutral-100 dark:bg-neutral-800 rounded-lg p-3 overflow-x-auto whitespace-pre">{children}</pre>
  );
}

// -- Code Form --
const LANGUAGES = [
  { value: "", label: "Auto-detect" },
  { value: "javascript", label: "JavaScript" }, { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" }, { value: "rust", label: "Rust" },
  { value: "go", label: "Go" }, { value: "java", label: "Java" },
  { value: "c", label: "C" }, { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" }, { value: "ruby", label: "Ruby" },
  { value: "php", label: "PHP" }, { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin" }, { value: "elixir", label: "Elixir" }, { value: "sql", label: "SQL" },
  { value: "html", label: "HTML" }, { value: "css", label: "CSS" },
  { value: "json", label: "JSON" }, { value: "yaml", label: "YAML" },
  { value: "toml", label: "TOML" }, { value: "bash", label: "Bash" },
  { value: "dockerfile", label: "Dockerfile" }, { value: "xml", label: "XML" },
  { value: "plaintext", label: "Plain Text" },
];

function CodeForm({ onResult }: { onResult: (r: { slug: string; encrypted: boolean; key?: string }) => void }) {
  const [content, setContent] = useState("");
  const [language, setLanguage] = useState("");
  const [filename, setFilename] = useState("");
  const { formProps, commonData, encrypted } = useCommonFields();
  const createCode = useCreateCode();
  const { toast } = useToast();

  if (formProps.slugType === "short") formProps.setSlugType("long");

  const handleSubmit = async () => {
    if (!content.trim()) { toast("error", "Content is required"); return; }

    let finalContent = content;
    let encryptionKeyStr: string | undefined;

    if (encrypted) {
      const key = await generateEncryptionKey();
      encryptionKeyStr = await exportKey(key);
      finalContent = await encryptText(content, key);
    }

    createCode.mutate(
      { content: finalContent, language: language || undefined, filename: filename.trim() || undefined, encrypted, ...commonData() },
      {
        onSuccess: (data) => { onResult({ slug: data.slug, encrypted: data.encrypted, key: encryptionKeyStr }); toast("success", "Snippet created!"); },
        onError: (e) => toast("error", e.message),
      }
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Select label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} options={LANGUAGES} />
        <Input label="Filename" value={filename} onChange={(e) => setFilename(e.target.value)} placeholder="main.ts" />
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Code</label>
        <CodeEditor
          key={language}
          value={content}
          onChange={setContent}
          language={language || "javascript"}
          placeholder="// paste your code here"
          minHeight="400px"
        />
      </div>
      <ShareFormFields {...formProps} />
      <Button onClick={handleSubmit} loading={createCode.isPending} className="w-full">Create Snippet</Button>
    </div>
  );
}

// -- File Form --
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileForm({ onResult }: { onResult: (r: { slug: string; encrypted: boolean; key?: string }) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { formProps, commonData, encrypted } = useCommonFields();
  const presignUpload = usePresignUpload();
  const createFile = useCreateFile();
  const { toast } = useToast();

  if (formProps.slugType === "short") formProps.setSlugType("long");

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  const handleSubmit = async () => {
    if (!file) { toast("error", "Select a file"); return; }
    if (file.size > 1024 * 1024 * 1024) { toast("error", "File too large (max 1GB)"); return; }

    setUploading(true);
    setProgress(0);
    try {
      let fileData = await file.arrayBuffer();
      let encryptionKeyStr: string | undefined;

      if (encrypted) {
        setProgress(5);
        const key = await generateEncryptionKey();
        encryptionKeyStr = await exportKey(key);
        fileData = await encryptFile(fileData, key);
        setProgress(15);
      }

      const contentType = encrypted ? "application/octet-stream" : file.type;
      let r2Key: string;

      if (fileData.byteLength > MULTIPART_THRESHOLD) {
        // Multipart chunked upload for large files
        setProgress(20);
        r2Key = await multipartUpload(fileData, file.name, contentType, (fraction) => {
          setProgress(20 + Math.round(fraction * 70));
        });
      } else {
        // Single upload for small files
        const { uploadId, r2Key: key } = await presignUpload.mutateAsync({
          filename: file.name, contentType, size: fileData.byteLength,
        });
        r2Key = key;
        setProgress(20);

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgress(20 + Math.round((e.loaded / e.total) * 70));
          };
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload failed")));
          xhr.onerror = () => reject(new Error("Upload failed"));
          xhr.open("PUT", `/api/upload/file/${uploadId}`);
          xhr.withCredentials = true;
          xhr.send(fileData);
        });
      }
      setProgress(90);

      const shareData = await createFile.mutateAsync({
        filename: file.name, content_type: file.type, size: file.size,
        r2_key: r2Key, encrypted, ...commonData(),
      });
      setProgress(100);
      onResult({ slug: shareData.slug, encrypted: shareData.encrypted, key: encryptionKeyStr });
      toast("success", "File uploaded!");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-neutral-300 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-600"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInput.current?.click()}
      >
        <input ref={fileInput} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <Upload size={28} className="mx-auto mb-2 text-neutral-500" />
        {file ? (
          <div>
            <div className="font-medium text-neutral-800 dark:text-neutral-200">{file.name}</div>
            <div className="text-sm text-neutral-500">{formatSize(file.size)}</div>
          </div>
        ) : (
          <div>
            <div className="text-neutral-600 dark:text-neutral-300 text-sm">Drop a file here or click to browse</div>
            <div className="text-xs text-neutral-500 dark:text-neutral-600 mt-1">Max 1GB</div>
          </div>
        )}
      </div>
      {uploading && (
        <div className="space-y-1">
          <div className="h-2 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all duration-300 rounded-full" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-xs text-neutral-500 text-center">{progress}%</div>
        </div>
      )}
      <ShareFormFields {...formProps} />
      <Button onClick={handleSubmit} loading={uploading} className="w-full">Upload & Share</Button>
    </div>
  );
}

// -- Gallery Form --
interface FileWithPreview { file: File; preview: string; caption: string; }

function GalleryForm({ onResult }: { onResult: (r: { slug: string; encrypted: boolean; key?: string }) => void }) {
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const { formProps, commonData, encrypted } = useCommonFields();
  const presignUpload = usePresignUpload();
  const createGallery = useCreateGallery();
  const { toast } = useToast();

  if (formProps.slugType === "short") formProps.setSlugType("long");

  const addFiles = (newFiles: FileList) => {
    const imageFiles = Array.from(newFiles).filter((f) => f.type.startsWith("image/"));
    const withPreviews = imageFiles.map((file) => ({
      file, preview: URL.createObjectURL(file), caption: "",
    }));
    setFiles((prev) => [...prev, ...withPreviews].slice(0, 50));
  };

  const removeFile = (index: number) => {
    setFiles((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSubmit = async () => {
    if (files.length === 0) { toast("error", "Add at least one image"); return; }
    setUploading(true);
    setProgress(0);
    try {
      let encryptionKeyStr: string | undefined;
      let encKey: CryptoKey | undefined;
      if (encrypted) {
        encKey = await generateEncryptionKey();
        encryptionKeyStr = await exportKey(encKey);
      }

      const uploadedImages: Array<{ filename: string; content_type: string; size: number; r2_key: string; caption?: string }> = [];

      for (let i = 0; i < files.length; i++) {
        const { file, caption } = files[i];
        let fileData = await file.arrayBuffer();
        if (encKey) fileData = await encryptFile(fileData, encKey);

        const contentType = encrypted ? "application/octet-stream" : file.type;
        let r2Key: string;

        if (fileData.byteLength > MULTIPART_THRESHOLD) {
          r2Key = await multipartUpload(fileData, file.name, contentType);
        } else {
          const { uploadId, r2Key: key } = await presignUpload.mutateAsync({
            filename: file.name, contentType, size: fileData.byteLength,
          });
          r2Key = key;
          const res = await fetch(`/api/upload/file/${uploadId}`, {
            method: "PUT", body: fileData, credentials: "same-origin",
          });
          if (!res.ok) throw new Error(`Failed to upload ${file.name}`);
        }

        uploadedImages.push({
          filename: file.name, content_type: file.type, size: file.size,
          r2_key: r2Key, caption: caption || undefined,
        });
        setProgress(Math.round(((i + 1) / files.length) * 90));
      }

      const shareData = await createGallery.mutateAsync({
        encrypted, images: uploadedImages, ...commonData(),
      });
      setProgress(100);
      onResult({ slug: shareData.slug, encrypted: shareData.encrypted, key: encryptionKeyStr });
      toast("success", "Gallery created!");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div
        className="border-2 border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg p-6 text-center cursor-pointer hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors"
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}
      >
        <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); }} />
        <Images size={28} className="mx-auto mb-2 text-neutral-500" />
        <div className="text-neutral-600 dark:text-neutral-300 text-sm">Drop images here or click to browse</div>
        <div className="text-xs text-neutral-500 dark:text-neutral-600 mt-1">Max 50 images</div>
      </div>
      {files.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {files.map((f, i) => (
            <div key={i} className="relative group">
              <img src={f.preview} alt={f.file.name} className="w-full h-20 object-cover rounded-lg" />
              <button onClick={() => removeFile(i)} className="absolute top-1 right-1 p-0.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="sr-only">Remove</span>&times;
              </button>
            </div>
          ))}
        </div>
      )}
      {uploading && (
        <div className="space-y-1">
          <div className="h-2 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all rounded-full" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-xs text-neutral-500 text-center">{progress}%</div>
        </div>
      )}
      <ShareFormFields {...formProps} />
      <Button onClick={handleSubmit} loading={uploading} className="w-full">Create Gallery</Button>
    </div>
  );
}
