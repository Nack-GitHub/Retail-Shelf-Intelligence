import { MobileShell } from "@/components/mobile/MobileShell";
import { AuthGate } from "@/components/auth/AuthGate";

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <MobileShell>
      <AuthGate>{children}</AuthGate>
    </MobileShell>
  );
}
