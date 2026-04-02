import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { api } from "../api/client";
import { useAuthStatus } from "../api/hooks";
import { Button } from "../components/ui/Button";
import { Share2, KeyRound } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: auth } = useAuthStatus();

  if (auth?.needsSetup) {
    navigate({ to: "/setup" });
    return null;
  }

  if (auth?.authenticated) {
    navigate({ to: "/" });
    return null;
  }

  const handleLogin = async () => {
    setLoading(true);
    setError("");

    try {
      // Get authentication options
      const options = await api.post<PublicKeyCredentialRequestOptionsJSON & { challengeId: string }>("/api/auth/login/options");

      // Trigger browser passkey UI
      const credential = await startAuthentication({ optionsJSON: options });

      // Verify with server
      await api.post("/api/auth/login/verify", {
        challengeId: options.challengeId,
        credential,
      });

      // Refresh auth state
      await queryClient.invalidateQueries({ queryKey: ["auth"] });
      navigate({ to: "/" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Share2 size={48} className="mx-auto text-primary mb-4" />
          <h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">{auth?.appName || "Share"}</h1>
          <p className="text-neutral-500 mt-2">Sign in to your account</p>
        </div>

        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 space-y-6">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 rounded-lg text-sm text-red-600 dark:text-red-300">
              {error}
            </div>
          )}

          <Button onClick={handleLogin} loading={loading} className="w-full" size="lg">
            <KeyRound size={18} />
            Sign in with Passkey
          </Button>

          <p className="text-xs text-neutral-500 dark:text-neutral-600 text-center">
            Use your registered passkey (Touch ID, Face ID, security key) to sign in.
          </p>
        </div>
      </div>
    </div>
  );
}
