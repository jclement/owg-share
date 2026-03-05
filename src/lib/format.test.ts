import { describe, it, expect } from "vitest";
import { formatBytes, formatSize, escapeHtml, inferLanguage } from "./format";

describe("formatBytes", () => {
  it("formats zero bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes under 1KB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 500)).toBe("500.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 5.5)).toBe("5.5 MB");
    expect(formatBytes(1024 * 1024 * 100)).toBe("100.0 MB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
    expect(formatBytes(1024 * 1024 * 1024 * 2.3)).toBe("2.3 GB");
  });

  it("handles boundary between KB and MB", () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe("1024.0 KB");
  });
});

describe("formatSize", () => {
  it("formats zero bytes", () => {
    expect(formatSize(0)).toBe("0 B");
  });

  it("formats bytes under 1KB", () => {
    expect(formatSize(512)).toBe("512 B");
  });

  it("formats kilobytes", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
  });

  it("formats megabytes (caps at MB)", () => {
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(1024 * 1024 * 500)).toBe("500.0 MB");
    // formatSize doesn't have GB tier, so large values still show MB
    expect(formatSize(1024 * 1024 * 1024)).toBe("1024.0 MB");
  });
});

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes less-than", () => {
    expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
  });

  it("escapes greater-than", () => {
    expect(escapeHtml("a > b")).toBe("a &gt; b");
  });

  it("escapes all special characters together", () => {
    expect(escapeHtml("<a href=\"#\">R&D</a>")).toBe("&lt;a href=\"#\"&gt;R&amp;D&lt;/a&gt;");
  });

  it("returns empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  it("handles multiple occurrences", () => {
    expect(escapeHtml("a & b & c")).toBe("a &amp; b &amp; c");
  });
});

describe("inferLanguage", () => {
  it("infers TypeScript", () => {
    expect(inferLanguage("main.ts")).toBe("typescript");
    expect(inferLanguage("component.tsx")).toBe("tsx");
  });

  it("infers JavaScript", () => {
    expect(inferLanguage("app.js")).toBe("javascript");
    expect(inferLanguage("component.jsx")).toBe("jsx");
  });

  it("infers Python", () => {
    expect(inferLanguage("script.py")).toBe("python");
  });

  it("infers Rust", () => {
    expect(inferLanguage("main.rs")).toBe("rust");
  });

  it("infers Go", () => {
    expect(inferLanguage("main.go")).toBe("go");
  });

  it("infers shell scripts", () => {
    expect(inferLanguage("script.sh")).toBe("bash");
    expect(inferLanguage("setup.bash")).toBe("bash");
  });

  it("infers config formats", () => {
    expect(inferLanguage("config.json")).toBe("json");
    expect(inferLanguage("config.yaml")).toBe("yaml");
    expect(inferLanguage("config.yml")).toBe("yaml");
    expect(inferLanguage("Cargo.toml")).toBe("toml");
  });

  it("infers markup/style", () => {
    expect(inferLanguage("index.html")).toBe("html");
    expect(inferLanguage("styles.css")).toBe("css");
    expect(inferLanguage("data.xml")).toBe("xml");
    expect(inferLanguage("README.md")).toBe("markdown");
  });

  it("infers other languages", () => {
    expect(inferLanguage("App.java")).toBe("java");
    expect(inferLanguage("app.cpp")).toBe("cpp");
    expect(inferLanguage("app.c")).toBe("c");
    expect(inferLanguage("app.cs")).toBe("csharp");
    expect(inferLanguage("app.rb")).toBe("ruby");
    expect(inferLanguage("app.php")).toBe("php");
    expect(inferLanguage("app.swift")).toBe("swift");
    expect(inferLanguage("app.kt")).toBe("kotlin");
    expect(inferLanguage("query.sql")).toBe("sql");
    expect(inferLanguage("app.lua")).toBe("lua");
    expect(inferLanguage("main.zig")).toBe("zig");
  });

  it("returns null for unknown extensions", () => {
    expect(inferLanguage("file.xyz")).toBeNull();
    expect(inferLanguage("file.docx")).toBeNull();
    expect(inferLanguage("file.pdf")).toBeNull();
  });

  it("returns null for files without extension", () => {
    expect(inferLanguage("Makefile")).toBeNull();
    expect(inferLanguage("Dockerfile")).toBe("dockerfile");
  });

  it("handles case-insensitive extensions", () => {
    expect(inferLanguage("file.PY")).toBe("python");
    expect(inferLanguage("file.TS")).toBe("typescript");
  });

  it("handles dotfiles and multi-dot names", () => {
    expect(inferLanguage(".gitignore")).toBeNull();
    expect(inferLanguage("app.test.ts")).toBe("typescript");
    expect(inferLanguage("config.prod.json")).toBe("json");
  });
});
