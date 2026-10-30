import Link from "next/link";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/dates";
import { requirePageActor } from "@/server/auth/current";
import { adminAuditLog } from "@/server/services/admin";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const actor = await requirePageActor("admin");
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const rows = await adminAuditLog(actor, page);
  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of sensitive actions (metadata only, secrets redacted)" />
      <Card>
        <CardBody>
          <Table>
            <thead><tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Resource</Th><Th>Details</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id.toString()}>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(r.at)}</Td>
                  <Td className="text-xs">{r.actorId?.email ?? r.actorRole ?? "system"}</Td>
                  <Td className="font-mono text-xs">{r.action}</Td>
                  <Td className="text-xs">{r.resourceType}{r.resourceId ? ` · ${r.resourceId.toString().slice(-6)}` : ""}</Td>
                  <Td className="max-w-xs truncate font-mono text-[11px] text-ink-500">{r.metadata ? JSON.stringify(r.metadata) : ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-4 flex gap-3 text-sm">
            {page > 1 ? <Link href={`?page=${page - 1}`} className="text-emerald-700 hover:underline">Newer</Link> : null}
            {rows.length === 100 ? <Link href={`?page=${page + 1}`} className="text-emerald-700 hover:underline">Older</Link> : null}
          </div>
        </CardBody>
      </Card>
    </>
  );
}
