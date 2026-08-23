import { request } from "@/lib/api/client";
import type { BlockedReason, Task } from "@/types";

interface TaskWire extends Omit<Task, "priority" | "blockedReason"> {
  priority: number;
  blockedReason: BlockedReason | null;
}

function toTask(wire: TaskWire): Task {
  return {
    ...wire,
    priority: (wire.priority === 1 || wire.priority === 3 ? wire.priority : 2) as 1 | 2 | 3,
    blockedReason: wire.blockedReason ?? undefined,
  };
}

/** The replenishment work this visit produced.
 *
 *  Tasks are created by the SERVER when a rep confirms a gap — the client
 *  never invents one. That is what keeps the task list and the findings from
 *  drifting apart when a verification is retried on a flaky connection. */
export async function fetchTasks(visitId: string): Promise<Task[]> {
  const wire = await request<TaskWire[]>(`/v1/visits/${visitId}/tasks`);
  return wire.map(toTask);
}

/** Marks a task fixed or blocked.
 *
 *  OUT_OF_BACKSTOCK raises a replenishment request server-side: the rep has
 *  already discovered that both the shelf and the stockroom are empty, and
 *  making them file that separately is how the information gets lost. */
export async function updateTask(
  taskId: string,
  status: "OPEN" | "FIXED" | "BLOCKED",
  blockedReason?: BlockedReason,
): Promise<Task> {
  return toTask(
    await request<TaskWire>(`/v1/tasks/${taskId}`, {
      method: "PATCH",
      body: { status, blockedReason: blockedReason ?? null },
    }),
  );
}
