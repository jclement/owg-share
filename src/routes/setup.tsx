import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { api } from "../api/client";
import { useAuthStatus } from "../api/hooks";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Share2, KeyRound } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

function SetupPage() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: auth } = useAuthStatus();

  // Redirect if already set up and authenticated
  if (auth && !auth.needsSetup && auth.authenticated) {
    navigate({ to: "/" });
    return null;
  }

  const handleRegister = async () => {
    if (!username.trim()) {
      setError("Username is required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Get registration options
      const options = await api.post<PublicKeyCredentialCreationOptionsJSON & { userId: string }>("/api/auth/register/options", { username: username.trim() });

      // Trigger browser passkey UI
      const credential = await startRegistration({ optionsJSON: options });

      // Verify with server
      await api.post("/api/auth/register/verify", {
        userId: options.userId,
        credential,
      });

      // Refresh auth state
      await queryClient.invalidateQueries({ queryKey: ["auth"] });
      navigate({ to: "/" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Share2 size={48} className="mx-auto text-primary mb-4" />
          <h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">OWG Share</h1>
          <p className="text-neutral-500 mt-2">Set up your sharing platform</p>
        </div>

        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">Create your account</h2>
            <p className="text-sm text-neutral-500">
              Choose a username and register a passkey to secure your account.
            </p>
          </div>

          <Input
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleRegister()}
          />

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 rounded-lg text-sm text-red-600 dark:text-red-300">
              {error}
            </div>
          )}

          <Button onClick={handleRegister} loading={loading} className="w-full" size="lg">
            <KeyRound size={18} />
            Register Passkey
          </Button>

          <p className="text-xs text-neutral-500 dark:text-neutral-600 text-center">
            You'll be prompted by your browser to create a passkey using Touch ID, Face ID, or your security key.
          </p>
        </div>
      </div>
    </div>
  );
}
