import { WebShell } from "@/components/web/WebShell";
import { AuthGate } from "@/components/auth/AuthGate";

export default function WebLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <WebShell>{children}</WebShell>
    </AuthGate>
  );
}
