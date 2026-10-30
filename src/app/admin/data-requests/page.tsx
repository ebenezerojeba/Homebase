import { StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/misc";
import { ResolveRequest } from "@/components/admin/admin-actions";
import { formatDateTime } from "@/lib/dates";
import { requirePageActor } from "@/server/auth/current";
import { listDataRequests } from "@/server/services/admin";

export const metadata = { title: "Data requests" };

export default async function DataRequestsPage() {
  const actor = await requirePageActor("admin");
  const items = await listDataRequests(actor);
  return (
    <>
      <PageHeader title="Data subject requests" description="NDPA 2023: respond within 30 days. Financial records may need to be retained — explain this to the user when declining deletion." />
      {items.length === 0 ? (
        <EmptyState title="No requests" />
      ) : (
        <Card>
          <CardBody>
            <Table>
              <thead><tr><Th>Received</Th><Th>User</Th><Th>Type</Th><Th>Details</Th><Th>Status</Th><Th /></tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r._id.toString()}>
                    <Td>{formatDateTime(r.createdAt)}</Td>
                    <Td>{r.userId?.name}<span className="block text-xs text-ink-500">{r.userId?.email} · {r.userId?.role}</span></Td>
                    <Td className="capitalize">{r.type}</Td>
                    <Td className="max-w-sm whitespace-pre-wrap text-xs">{r.details}</Td>
                    <Td><StatusBadge status={r.status === "open" ? "submitted" : r.status === "completed" ? "completed" : r.status === "declined" ? "rejected" : "in_progress"} /></Td>
                    <Td>{r.status === "open" || r.status === "in_progress" ? <ResolveRequest id={r._id.toString()} /> : null}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </>
  );
}
