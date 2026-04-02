import { createRootRouteWithContext, Outlet, Link, useNavigate } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { useAuthStatus, useLogout } from "../api/hooks";
import { useTheme } from "../components/ThemeProvider";
import { ToastProvider } from "../components/ui/Toast";
import { FullPageSpinner } from "../components/ui/Spinner";
import {
  LogOut, Share2,
  Sun, Moon, Monitor, User, ChevronDown, Shield, Key
} from "lucide-react";
import { useState, useRef, useEffect } from "react";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <ToastProvider>
      <AuthGate />
    </ToastProvider>
  );
}

function AuthGate() {
  const { data: auth, isLoading } = useAuthStatus();

  useEffect(() => {
    if (auth?.appName) document.title = auth.appName;
  }, [auth?.appName]);

  if (isLoading) return <FullPageSpinner />;

  if (auth?.needsSetup || !auth?.authenticated) {
    return <Outlet />;
  }

  return <AppShell username={auth.user?.username || ""} appName={auth.appName || "Share"} />;
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const options = [
    { value: "system" as const, icon: Monitor },
    { value: "light" as const, icon: Sun },
    { value: "dark" as const, icon: Moon },
  ];

  return (
    <div className="flex items-center bg-neutral-200 dark:bg-neutral-800 rounded-lg p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setTheme(opt.value)}
          className={`p-1.5 rounded-md transition-colors ${
            theme === opt.value
              ? "bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-sm"
              : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
          }`}
          title={opt.value.charAt(0).toUpperCase() + opt.value.slice(1)}
        >
          <opt.icon size={14} />
        </button>
      ))}
    </div>
  );
}

function UserMenu({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const logout = useLogout();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleLogout = () => {
    setOpen(false);
    logout.mutate(undefined, {
      onSuccess: () => navigate({ to: "/login" }),
    });
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
      >
        <User size={16} />
        <span className="hidden sm:inline">{username}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg shadow-lg py-1 z-50">
          <Link
            to="/settings/passkeys"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <Shield size={15} />
            Passkeys
          </Link>
          <Link
            to="/settings/api-keys"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <Key size={15} />
            API Keys
          </Link>
          <div className="border-t border-neutral-200 dark:border-neutral-800 my-1" />
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors w-full"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function AppShell({ username, appName }: { username: string; appName: string }) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 lg:px-6 h-14 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
        <Link to="/" className="flex items-center gap-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          <Share2 size={20} className="text-primary" />
          {appName}
        </Link>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <UserMenu username={username} />
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">
        <div className="p-4 lg:p-8 max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
