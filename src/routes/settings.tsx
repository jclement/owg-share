import { createFileRoute, Outlet, Link, useMatchRoute } from "@tanstack/react-router";
import { Shield, Key } from "lucide-react";

export const Route = createFileRoute("/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const matchRoute = useMatchRoute();
  const isPasskeys = matchRoute({ to: "/settings/passkeys" });
  const isApiKeys = matchRoute({ to: "/settings/api-keys" });

  const tabClass = (active: boolean) =>
    `flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
      active
        ? "bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
        : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800/50"
    }`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Settings</h1>
      <div className="flex gap-2">
        <Link to="/settings/passkeys" className={tabClass(!!isPasskeys)}>
          <Shield size={16} /> Passkeys
        </Link>
        <Link to="/settings/api-keys" className={tabClass(!!isApiKeys)}>
          <Key size={16} /> API Keys
        </Link>
      </div>
      <Outlet />
    </div>
  );
}
