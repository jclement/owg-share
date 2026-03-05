import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { useTheme } from "../../components/ThemeProvider";
import { FullPageSpinner } from "../../components/ui/Spinner";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import {
  extractKeyFromHash, importKey, decryptText,
} from "../../lib/crypto";
import {
  Download, Copy, Check, Lock, Eye, Calendar,
  File, ChevronLeft, ChevronRight, X, FileCode
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
      const decrypted = { ...data, encrypted: false };

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
      return <CodeRenderer content={data.code?.content || ""} language={data.code?.language} filename={data.code?.filename} slug={data.slug} />;
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
  const { resolved: themeMode } = useTheme();
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;

    // Copy button click delegation
    node.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(".copy-code-btn");
      if (!btn) return;
      const pre = btn.closest(".code-block-wrapper")?.querySelector("pre");
      if (!pre) return;
      navigator.clipboard.writeText(pre.textContent || "");
      btn.innerHTML = checkSvgSmall;
      btn.classList.add("copied");
      setTimeout(() => {
        btn.innerHTML = copySvgSmall;
        btn.classList.remove("copied");
      }, 2000);
    });

    // Render mermaid diagrams after HTML is set
    const mermaidEls = node.querySelectorAll<HTMLElement>(".mermaid-block");
    if (mermaidEls.length === 0) return;
    import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: themeMode === "dark" ? "dark" : "default",
        fontFamily: "inherit",
      });
      mermaidEls.forEach(async (el, i) => {
        try {
          const { svg } = await mermaid.render(`mermaid-${i}-${Date.now()}`, el.textContent || "");
          el.innerHTML = svg;
          el.classList.add("mermaid-rendered");
        } catch {
          el.classList.add("mermaid-error");
        }
      });
    });
  }, [html, themeMode]);

  useEffect(() => {
    (async () => {
      const [{ marked }, { default: DOMPurify }, { createHighlighter }] = await Promise.all([
        import("marked"),
        import("dompurify"),
        import("shiki"),
      ]);

      // Always use dark theme for code blocks in markdown — gives consistent dark contrast
      const shikiTheme = "github-dark";
      let highlighter: Awaited<ReturnType<typeof createHighlighter>> | null = null;

      const renderer = new marked.Renderer();
      const wrapCode = (html: string) =>
        `<div class="code-block-wrapper">${html}<button class="copy-code-btn" title="Copy">${copySvgSmall}</button></div>`;

      renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
        // Mermaid blocks — render as placeholder, hydrated after mount
        if (lang === "mermaid") {
          return `<div class="mermaid-block my-3">${escapeHtml(text)}</div>`;
        }
        if (highlighter && lang) {
          try {
            return wrapCode(highlighter.codeToHtml(text, { lang, theme: shikiTheme }));
          } catch {
            // language not loaded, fall through
          }
        }
        return wrapCode(`<pre style="background:#24292e;color:#e1e4e8"><code class="language-${escapeHtml(lang || "plaintext")}">${escapeHtml(text)}</code></pre>`);
      };

      // Obsidian-style callouts: > [!type] Title
      const isDark = themeMode === "dark";
      renderer.blockquote = function ({ text }: { text: string }) {
        const calloutMatch = text.match(/^\[!([\w-]+)\]\s*(.*?)(?:\n([\s\S]*))?$/);
        if (calloutMatch) {
          const type = calloutMatch[1].toLowerCase();
          const title = calloutMatch[2]?.trim() || type.charAt(0).toUpperCase() + type.slice(1);
          const bodyRaw = calloutMatch[3]?.trim() || "";
          const bodyHtml = bodyRaw ? marked.parse(bodyRaw, { async: false }) as string : "";
          const { icon, bg, accent, text: textColor } = calloutStyle(type, isDark);
          return `<div class="callout" style="background:${bg};border-left:4px solid ${accent};color:${textColor};border-radius:0.5rem;padding:0.75rem 1rem;margin:0.75rem 0">
            <div style="font-weight:600;display:flex;align-items:center;gap:0.5rem${bodyHtml ? ";margin-bottom:0.25rem" : ""}">${icon} ${escapeHtml(title)}</div>
            ${bodyHtml ? `<div style="font-size:0.875rem;opacity:0.9">${bodyHtml}</div>` : ""}
          </div>`;
        }
        return `<blockquote>${text}</blockquote>`;
      };

      // Collect languages from content to load (excluding mermaid)
      const langSet = new Set<string>();
      const codeBlockRegex = /```(\w+)/g;
      let match;
      while ((match = codeBlockRegex.exec(content)) !== null) {
        if (match[1] !== "mermaid") langSet.add(match[1]);
      }

      if (langSet.size > 0) {
        try {
          highlighter = await createHighlighter({
            themes: [shikiTheme],
            langs: [...langSet],
          });
        } catch {
          // Shiki failed to load, will use plain code blocks
        }
      }

      const raw = marked.parse(content, { renderer });
      const resolved = typeof raw === "string" ? raw : await raw;
      // Allow mermaid divs and callout styles through DOMPurify
      DOMPurify.addHook("uponSanitizeElement", (node, data) => {
        if (data.tagName === "div" && (node as HTMLElement).classList?.contains("mermaid-block")) {
          data.allowedTags["div"] = true;
        }
      });
      setHtml(DOMPurify.sanitize(resolved, {
        ADD_TAGS: ["div", "button"],
        ADD_ATTR: ["class", "style", "title"],
      }));
      DOMPurify.removeAllHooks();
    })();
  }, [content, themeMode]);

  const copyRaw = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div className="flex justify-end gap-1 mb-4">
        <Button variant="ghost" size="sm" onClick={copyRaw}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div
        ref={containerRef}
        className="prose prose-neutral dark:prose-invert max-w-none prose-headings:text-neutral-900 dark:prose-headings:text-neutral-100 prose-a:text-primary dark:prose-a:text-primary-light prose-strong:text-neutral-800 dark:prose-strong:text-neutral-200 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:p-4 prose-p:my-2 prose-headings:mt-6 prose-headings:mb-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-pre:my-3 prose-blockquote:my-3 prose-hr:my-4 [&_.mermaid-block]:flex [&_.mermaid-block]:justify-center [&_.mermaid-rendered]:bg-transparent [&_.callout]:not-prose [&_code:not(pre_code)]:bg-neutral-100 dark:[&_code:not(pre_code)]:bg-neutral-800 [&_code:not(pre_code)]:px-1.5 [&_code:not(pre_code)]:py-0.5 [&_code:not(pre_code)]:rounded [&_code:not(pre_code)]:text-sm"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

// Copy/check SVGs for code block buttons (14px)
const copySvgSmall = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const checkSvgSmall = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

// Inline SVG icons for callouts (16px, Lucide-style stroke icons)
const svgIcon = (path: string, color: string) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">${path}</svg>`;

function calloutStyle(type: string, isDark: boolean): { icon: string; bg: string; accent: string; text: string } {
  // [bg, accent/left-border, text]
  const c = (light: [string, string, string], dark: [string, string, string]) =>
    isDark ? { bg: dark[0], accent: dark[1], text: dark[2] } : { bg: light[0], accent: light[1], text: light[2] };

  const icons: Record<string, string> = {
    info:     '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    tip:      '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 1 4 12.9V17H8v-2.1A7 7 0 0 1 12 2z"/>',
    warning:  '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    danger:   '<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    caution:  '<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    note:     '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    abstract: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    summary:  '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    success:  '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    question: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    failure:  '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    bug:      '<rect x="8" y="6" width="8" height="14" rx="4"/><path d="M19 10h2"/><path d="M3 10h2"/><path d="M19 14h2"/><path d="M3 14h2"/><path d="M17 4l2-2"/><path d="M5 4L3 2"/>',
    example:  '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    quote:    '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/>',
  };

  const defs: Record<string, { light: [string, string, string]; dark: [string, string, string] }> = {
    info:     { light: ["#f0f4f8", "#3b82f6", "#1e3a5f"], dark: ["#1e293b", "#3b82f6", "#e2e8f0"] },
    tip:      { light: ["#f0f9f4", "#22c55e", "#14532d"], dark: ["#1a2e1f", "#22c55e", "#e2e8f0"] },
    warning:  { light: ["#fef9e7", "#eab308", "#713f12"], dark: ["#2a2517", "#eab308", "#e2e8f0"] },
    danger:   { light: ["#fef2f2", "#ef4444", "#7f1d1d"], dark: ["#2a1717", "#ef4444", "#e2e8f0"] },
    caution:  { light: ["#fef2f2", "#ef4444", "#7f1d1d"], dark: ["#2a1717", "#ef4444", "#e2e8f0"] },
    note:     { light: ["#f5f5f5", "#737373", "#262626"], dark: ["#262626", "#737373", "#e2e8f0"] },
    abstract: { light: ["#ecfeff", "#06b6d4", "#164e63"], dark: ["#1a2a2e", "#06b6d4", "#e2e8f0"] },
    summary:  { light: ["#ecfeff", "#06b6d4", "#164e63"], dark: ["#1a2a2e", "#06b6d4", "#e2e8f0"] },
    success:  { light: ["#f0f9f4", "#22c55e", "#14532d"], dark: ["#1a2e1f", "#22c55e", "#e2e8f0"] },
    question: { light: ["#fef9e7", "#eab308", "#713f12"], dark: ["#2a2517", "#eab308", "#e2e8f0"] },
    failure:  { light: ["#fef2f2", "#ef4444", "#7f1d1d"], dark: ["#2a1717", "#ef4444", "#e2e8f0"] },
    bug:      { light: ["#fef2f2", "#ef4444", "#7f1d1d"], dark: ["#2a1717", "#ef4444", "#e2e8f0"] },
    example:  { light: ["#faf5ff", "#a855f7", "#581c87"], dark: ["#231a2e", "#a855f7", "#e2e8f0"] },
    quote:    { light: ["#f5f5f5", "#737373", "#262626"], dark: ["#262626", "#737373", "#e2e8f0"] },
  };
  const def = defs[type] || defs.note;
  const colors = c(def.light, def.dark);
  const iconPath = icons[type] || icons.note;
  return { icon: svgIcon(iconPath, colors.accent), ...colors };
}

function CodeRenderer({ content, language, filename, slug }: { content: string; language?: string | null; filename?: string | null; slug: string }) {
  const [highlighted, setHighlighted] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    import("shiki").then(async ({ createHighlighter }) => {
      const lang = language || inferLanguage(filename || "") || "plaintext";
      try {
        const highlighter = await createHighlighter({
          themes: ["github-dark"],
          langs: [lang],
        });
        setHighlighted(highlighter.codeToHtml(content, { lang, theme: "github-dark" }));
      } catch {
        setHighlighted("");
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
        <div className="flex gap-1">
          <a href={`/s/${slug}/raw`} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="sm">
              <FileCode size={14} /> Raw
            </Button>
          </a>
          <Button variant="ghost" size="sm" onClick={copyCode}>
            {copied ? <Check size={14} /> : <Copy size={14} />} Copy
          </Button>
        </div>
      </div>
      <div
        className="overflow-x-auto text-sm [&_pre]:p-4 [&_pre]:m-0 [&_pre]:rounded-lg [&_code]:font-mono"
        dangerouslySetInnerHTML={{ __html: highlighted || `<pre style="background:#24292e;color:#e1e4e8" class="p-4"><code>${escapeHtml(content)}</code></pre>` }}
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
