import { MobileShell } from "@/components/mobile/MobileShell";
import { AuthGate } from "@/components/auth/AuthGate";
import { QueueDrainer } from "@/components/offline/QueueDrainer";

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <MobileShell>
      <AuthGate>
        <QueueDrainer />
        {children}
      </AuthGate>
    </MobileShell>
  );
}
