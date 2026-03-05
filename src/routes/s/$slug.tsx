import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { FullPageSpinner } from "../../components/ui/Spinner";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import {
  extractKeyFromHash, importKey, decryptText,
} from "../../lib/crypto";
import {
  Download, Copy, Check, Lock, Eye, Calendar,
  File, ChevronLeft, ChevronRight, X
} from "lucide-react";

export const Route = createFileRoute("/s/$slug")({
  component: PublicViewPage,
});

interface ShareData {
  id: string;
  slug: string;
  type: "link" | "markdown" | "code" | "file" | "gallery";
  title: string | null;
  encrypted: boolean;
  hits: number;
  created_at: string;
  markdown?: { content: string };
  code?: { content: string; language: string | null; filename: string | null };
  file?: { filename: string; content_type: string; size: number; r2_key: string };
  gallery?: { id: string };
  images?: Array<{ id: string; filename: string; content_type: string; size: number; r2_key: string; sort_order: number; caption: string | null }>;
}

function PublicViewPage() {
  const { slug } = Route.useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ["public", slug],
    queryFn: async () => {
      const res = await fetch(`/s/data/${slug}`, { credentials: "same-origin" });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new ApiError(body.error?.code || "UNKNOWN", body.error?.message || "Not found", res.status);
      }
      const data = body.data as ShareData & { link?: { url: string } };
      // If it's a link, redirect
      if (data.type === "link" && data.link?.url) {
        window.location.href = data.link.url;
        return null;
      }
      return data;
    },
    retry: false,
  });

  if (isLoading) return <FullPageSpinner />;

  if (error) {
    const apiErr = error as ApiError;
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-6xl font-bold text-neutral-300 dark:text-neutral-700 mb-4">
            {apiErr.status === 410 ? "410" : apiErr.status === 404 ? "404" : "Error"}
          </div>
          <p className="text-neutral-600 dark:text-neutral-400">{apiErr.message}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      <div className="max-w-4xl mx-auto p-4 lg:p-8">
        {/* Header */}
        <div className="mb-8">
          {data.title && <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">{data.title}</h1>}
          <div className="flex items-center gap-4 text-sm text-neutral-500">
            <span className="flex items-center gap-1"><Calendar size={14} /> {new Date(data.created_at).toLocaleDateString()}</span>
            <span className="flex items-center gap-1"><Eye size={14} /> {data.hits} views</span>
            {data.encrypted && <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-500"><Lock size={14} /> Encrypted</span>}
          </div>
        </div>

        {/* Content */}
        {data.encrypted ? (
          <EncryptedView data={data} />
        ) : (
          <ContentRenderer data={data} />
        )}
      </div>
    </div>
  );
}

function EncryptedView({ data }: { data: ShareData }) {
  const [decryptedData, setDecryptedData] = useState<ShareData | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [error, setError] = useState("");
  const [decrypting, setDecrypting] = useState(false);

  const doDecrypt = useCallback(async (keyStr: string) => {
    setDecrypting(true);
    setError("");
    try {
      const key = await importKey(keyStr);
      const decrypted = { ...data };

      if (data.markdown?.content) {
        const plaintext = await decryptText(data.markdown.content, key);
        decrypted.markdown = { content: plaintext };
      }
      if (data.code?.content) {
        const plaintext = await decryptText(data.code.content, key);
        decrypted.code = { ...data.code, content: plaintext };
      }

      setDecryptedData(decrypted);
    } catch {
      setError("Decryption failed. Check the key and try again.");
    } finally {
      setDecrypting(false);
    }
  }, [data]);

  // Auto-decrypt if key is in URL hash
  useEffect(() => {
    const hashKey = extractKeyFromHash();
    if (hashKey) {
      doDecrypt(hashKey);
    }
  }, [doDecrypt]);

  if (decryptedData) {
    return <ContentRenderer data={decryptedData} />;
  }

  return (
    <div className="max-w-md mx-auto mt-16">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 text-center space-y-4">
        <Lock size={40} className="mx-auto text-yellow-500" />
        <h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-200">This content is encrypted</h2>
        <p className="text-sm text-neutral-500">Enter the decryption key to view this content.</p>
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 rounded-lg text-sm text-red-600 dark:text-red-300">{error}</div>
        )}
        <Input
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder="Paste decryption key or full URL"
          onKeyDown={(e) => {
            if (e.key === "Enter" && keyInput.trim()) {
              // Extract key from pasted URL or use as-is
              const match = keyInput.match(/key=([A-Za-z0-9_-]+)/);
              doDecrypt(match ? match[1] : keyInput.trim());
            }
          }}
        />
        <Button
          onClick={() => {
            const match = keyInput.match(/key=([A-Za-z0-9_-]+)/);
            doDecrypt(match ? match[1] : keyInput.trim());
          }}
          loading={decrypting}
          className="w-full"
        >
          Decrypt
        </Button>
      </div>
    </div>
  );
}

function ContentRenderer({ data }: { data: ShareData }) {
  switch (data.type) {
    case "markdown":
      return <MarkdownRenderer content={data.markdown?.content || ""} />;
    case "code":
      return <CodeRenderer content={data.code?.content || ""} language={data.code?.language} filename={data.code?.filename} />;
    case "file":
      return <FileRenderer slug={data.slug} file={data.file!} encrypted={data.encrypted} />;
    case "gallery":
      return <GalleryRenderer slug={data.slug} images={data.images || []} encrypted={data.encrypted} />;
    default:
      return <div className="text-neutral-500">Unknown content type</div>;
  }
}

function MarkdownRenderer({ content }: { content: string }) {
  const [html, setHtml] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    import("marked").then(({ marked }) => {
      import("dompurify").then(({ default: DOMPurify }) => {
        const raw = marked.parse(content);
        if (typeof raw === "string") {
          setHtml(DOMPurify.sanitize(raw));
        } else {
          raw.then((resolved) => setHtml(DOMPurify.sanitize(resolved)));
        }
      });
    });
  }, [content]);

  const copyRaw = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button variant="ghost" size="sm" onClick={copyRaw}>
          {copied ? <Check size={14} /> : <Copy size={14} />} Raw
        </Button>
      </div>
      <div
        className="prose prose-neutral dark:prose-invert max-w-none prose-pre:bg-neutral-100 dark:prose-pre:bg-neutral-900 prose-pre:border prose-pre:border-neutral-300 dark:prose-pre:border-neutral-800 prose-code:text-primary dark:prose-code:text-primary-light prose-headings:text-neutral-900 dark:prose-headings:text-neutral-100 prose-a:text-primary dark:prose-a:text-primary-light prose-strong:text-neutral-800 dark:prose-strong:text-neutral-200"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function CodeRenderer({ content, language, filename }: { content: string; language?: string | null; filename?: string | null }) {
  const [highlighted, setHighlighted] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    import("shiki").then(async ({ createHighlighter }) => {
      const lang = language || inferLanguage(filename || "") || "plaintext";
      try {
        const highlighter = await createHighlighter({
          themes: ["github-light", "github-dark"],
          langs: [lang],
        });
        setHighlighted(highlighter.codeToHtml(content, {
          lang,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
        }));
      } catch {
        // Fallback to plain text
        setHighlighted(`<pre class="shiki"><code>${escapeHtml(content)}</code></pre>`);
      }
    });
  }, [content, language, filename]);

  const copyCode = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {filename && <span className="text-sm font-mono text-neutral-600 dark:text-neutral-400">{filename}</span>}
          {language && <span className="text-xs px-2 py-0.5 bg-neutral-200 dark:bg-neutral-800 rounded text-neutral-600 dark:text-neutral-400">{language}</span>}
        </div>
        <Button variant="ghost" size="sm" onClick={copyCode}>
          {copied ? <Check size={14} /> : <Copy size={14} />} Copy
        </Button>
      </div>
      <div
        className="rounded-lg border border-neutral-300 dark:border-neutral-800 overflow-x-auto text-sm [&_pre]:bg-neutral-100! dark:[&_pre]:bg-neutral-900! [&_pre]:p-4 [&_code]:font-mono"
        dangerouslySetInnerHTML={{ __html: highlighted || `<pre class="bg-neutral-100 dark:bg-neutral-900 p-4"><code>${escapeHtml(content)}</code></pre>` }}
      />
    </div>
  );
}

function FileRenderer({ slug, file, encrypted }: { slug: string; file: ShareData["file"] & {}; encrypted: boolean }) {
  if (!file) return null;
  const isImage = file.content_type.startsWith("image/");
  const isVideo = file.content_type.startsWith("video/");
  const isAudio = file.content_type.startsWith("audio/");
  const isPdf = file.content_type === "application/pdf";

  const downloadUrl = `/s/${slug}/download`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 p-4 bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-800 rounded-lg">
        <File size={24} className="text-neutral-500 dark:text-neutral-400" />
        <div className="flex-1">
          <div className="font-medium text-neutral-800 dark:text-neutral-200">{file.filename}</div>
          <div className="text-sm text-neutral-500">{file.content_type} · {formatBytes(file.size)}</div>
        </div>
        {!encrypted && (
          <a href={downloadUrl} download>
            <Button variant="secondary"><Download size={16} /> Download</Button>
          </a>
        )}
      </div>

      {!encrypted && isImage && (
        <img src={downloadUrl} alt={file.filename} className="max-w-full rounded-lg border border-neutral-300 dark:border-neutral-800" />
      )}
      {!encrypted && isVideo && (
        <video src={downloadUrl} controls className="max-w-full rounded-lg border border-neutral-300 dark:border-neutral-800" />
      )}
      {!encrypted && isAudio && (
        <audio src={downloadUrl} controls className="w-full" />
      )}
      {!encrypted && isPdf && (
        <iframe src={downloadUrl} className="w-full h-[80vh] rounded-lg border border-neutral-300 dark:border-neutral-800" />
      )}
    </div>
  );
}

function GalleryRenderer({ slug, images, encrypted }: { slug: string; images: NonNullable<ShareData["images"]>; encrypted: boolean }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIndex(null);
      if (e.key === "ArrowLeft") setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i));
      if (e.key === "ArrowRight") setLightboxIndex((i) => (i !== null && i < images.length - 1 ? i + 1 : i));
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [lightboxIndex, images.length]);

  if (images.length === 0) {
    return <div className="text-center py-12 text-neutral-500">No images in this gallery</div>;
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {images.map((img, i) => (
          <div
            key={img.id}
            className="relative group cursor-pointer overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-700 transition-colors"
            onClick={() => !encrypted && setLightboxIndex(i)}
          >
            {!encrypted ? (
              <img
                src={`/s/${slug}/image/${img.id}`}
                alt={img.caption || img.filename}
                className="w-full h-48 object-cover transition-transform group-hover:scale-105"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-48 bg-neutral-100 dark:bg-neutral-900 flex items-center justify-center">
                <Lock size={24} className="text-neutral-400 dark:text-neutral-600" />
              </div>
            )}
            {img.caption && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                <p className="text-sm text-white">{img.caption}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center" onClick={() => setLightboxIndex(null)}>
          <button onClick={() => setLightboxIndex(null)} className="absolute top-4 right-4 p-2 text-white/60 hover:text-white z-10">
            <X size={24} />
          </button>

          {lightboxIndex > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex - 1); }}
              className="absolute left-4 p-2 text-white/60 hover:text-white z-10"
            >
              <ChevronLeft size={32} />
            </button>
          )}

          <img
            src={`/s/${slug}/image/${images[lightboxIndex].id}`}
            alt={images[lightboxIndex].caption || images[lightboxIndex].filename}
            className="max-w-[90vw] max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {lightboxIndex < images.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex + 1); }}
              className="absolute right-4 p-2 text-white/60 hover:text-white z-10"
            >
              <ChevronRight size={32} />
            </button>
          )}

          {images[lightboxIndex].caption && (
            <div className="absolute bottom-8 left-0 right-0 text-center">
              <p className="text-white/80 text-sm bg-black/50 inline-block px-4 py-2 rounded-lg">
                {images[lightboxIndex].caption}
              </p>
            </div>
          )}

          <div className="absolute bottom-4 left-0 right-0 text-center text-white/40 text-xs">
            {lightboxIndex + 1} / {images.length}
          </div>
        </div>
      )}
    </>
  );
}

// Helpers
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inferLanguage(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    py: "python", rs: "rust", go: "go", java: "java",
    c: "c", cpp: "cpp", cs: "csharp", rb: "ruby",
    php: "php", swift: "swift", kt: "kotlin", sql: "sql",
    html: "html", css: "css", json: "json", yaml: "yaml", yml: "yaml",
    toml: "toml", md: "markdown", sh: "bash", bash: "bash",
    dockerfile: "dockerfile", xml: "xml", lua: "lua", zig: "zig",
  };
  return ext ? map[ext] || null : null;
}
