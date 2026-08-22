import { WebShell } from "@/components/web/WebShell";

export default function WebLayout({ children }: { children: React.ReactNode }) {
  return <WebShell>{children}</WebShell>;
}
