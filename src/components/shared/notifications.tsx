"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { api, useAction } from "@/lib/api-client";
import { cn } from "@/lib/cn";

export interface NotificationItem {
  _id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationList({ items }: { items: NotificationItem[] }) {
  const markAll = useAction(() => api("/api/notifications", { body: { ids: "all" } }), { success: "All marked as read" });
  const markOne = useAction((id: string) => api("/api/notifications", { body: { ids: [id] } }));
  const unread = items.some((n) => !n.readAt);
  return (
    <div>
      {unread ? (
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="outline" loading={markAll.pending} onClick={() => markAll.run()}>Mark all as read</Button>
        </div>
      ) : null}
      <ul className="divide-y divide-cream-200 overflow-hidden rounded-card border border-cream-300 bg-white">
        {items.map((n) => (
          <li key={n._id} className={cn("flex gap-3 px-5 py-4", !n.readAt && "bg-emerald-50/50")}>
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-emerald-600")} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm", n.readAt ? "text-ink-800" : "font-semibold text-ink-900")}>
                {n.title}
                {!n.readAt ? <span className="sr-only"> (unread)</span> : null}
              </p>
              <p className="mt-0.5 text-sm text-ink-600">{n.body}</p>
              <p className="mt-1 text-xs text-ink-400">{new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }).format(new Date(n.createdAt))}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {n.link ? (
                <Link href={n.link} onClick={() => !n.readAt && markOne.run(n._id)} className="text-sm font-medium text-emerald-700 hover:underline">Open</Link>
              ) : null}
              {!n.readAt ? (
                <button className="text-xs text-ink-500 hover:text-ink-800" onClick={() => markOne.run(n._id)}>Mark read</button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
