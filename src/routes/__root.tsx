import { createRootRouteWithContext, Outlet, Link, useNavigate } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { useAuthStatus, useLogout } from "../api/hooks";
import { useTheme } from "../components/ThemeProvider";
import { ToastProvider } from "../components/ui/Toast";
import { FullPageSpinner } from "../components/ui/Spinner";
import {
  LayoutDashboard, Settings, LogOut, Menu, X, Share2,
  Sun, Moon, Monitor
} from "lucide-react";
import { useState } from "react";

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

  if (isLoading) return <FullPageSpinner />;

  if (auth?.needsSetup || !auth?.authenticated) {
    return <Outlet />;
  }

  return <AppShell username={auth.user?.username || ""} />;
}

const themeOptions = [
  { value: "system" as const, icon: Monitor, label: "System" },
  { value: "light" as const, icon: Sun, label: "Light" },
  { value: "dark" as const, icon: Moon, label: "Dark" },
];

function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center gap-1 px-3 py-1.5">
      {themeOptions.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setTheme(opt.value)}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors ${
            theme === opt.value
              ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100"
              : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
          }`}
          title={opt.label}
        >
          <opt.icon size={13} />
          <span className="hidden sm:inline">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

function AppShell({ username }: { username: string }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const logout = useLogout();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => navigate({ to: "/login" }),
    });
  };

  const navItems = [
    { to: "/" as const, label: "Dashboard", icon: LayoutDashboard },
  ];

  return (
    <div className="min-h-screen flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-neutral-50 dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 flex flex-col transition-transform lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800">
          <Link to="/" className="flex items-center gap-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            <Share2 size={22} className="text-primary" />
            OWG Share
          </Link>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-200/50 dark:hover:bg-neutral-800 transition-colors [&.active]:bg-neutral-200/50 dark:[&.active]:bg-neutral-800 [&.active]:text-neutral-900 dark:[&.active]:text-neutral-100"
            >
              <item.icon size={18} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-neutral-200 dark:border-neutral-800 space-y-1">
          <ThemeToggle />
          <Link
            to="/settings"
            onClick={() => setSidebarOpen(false)}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-200/50 dark:hover:bg-neutral-800 transition-colors [&.active]:bg-neutral-200/50 dark:[&.active]:bg-neutral-800 [&.active]:text-neutral-900 dark:[&.active]:text-neutral-100"
          >
            <Settings size={18} />
            Settings
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-neutral-600 dark:text-neutral-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-neutral-200/50 dark:hover:bg-neutral-800 transition-colors w-full"
          >
            <LogOut size={18} />
            Sign out
          </button>
          <div className="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-600">
            Signed in as <span className="text-neutral-700 dark:text-neutral-400 font-mono">{username}</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center gap-3 p-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
          <button onClick={() => setSidebarOpen(true)} className="text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            <Menu size={22} />
          </button>
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">OWG Share</span>
        </header>

        <div className="p-4 lg:p-8 max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
