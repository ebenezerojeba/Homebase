import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { FilterBar, Table, Td, Th } from "@/components/ui/misc";
import { UserStatusButton } from "@/components/admin/admin-actions";
import { formatDateTime } from "@/lib/dates";
import { requirePageActor } from "@/server/auth/current";
import { adminListUsers, adminUserQuery } from "@/server/services/admin";

export const metadata = { title: "Users" };

export default async function AdminUsers({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const actor = await requirePageActor("admin");
  const q = adminUserQuery.parse(await searchParams);
  const { items } = await adminListUsers(actor, q);
  return (
    <>
      <PageHeader title="Users" description="Searches are recorded in the audit log" />
      <FilterBar>
        <Input name="q" defaultValue={q.q} placeholder="Name or email" className="w-72" aria-label="Search users" />
        <Button type="submit" variant="outline">Search</Button>
      </FilterBar>
      <Card>
        <CardBody>
          <Table>
            <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Verified</Th><Th>Last sign-in</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {items.map((u) => (
                <tr key={u._id.toString()}>
                  <Td>{u.name}</Td>
                  <Td>{u.email}</Td>
                  <Td className="capitalize">{u.role}</Td>
                  <Td>{u.emailVerifiedAt ? "Yes" : "No"}</Td>
                  <Td>{formatDateTime(u.lastLoginAt)}</Td>
                  <Td><StatusBadge status={u.status === "active" ? "active" : "revoked"} /></Td>
                  <Td className="text-right">{u.role !== "admin" ? <UserStatusButton userId={u._id.toString()} status={u.status} /> : null}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
