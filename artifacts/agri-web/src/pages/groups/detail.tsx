import { useRoute, Link } from "wouter";
import { useGetGroup } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Users, MapPin } from "lucide-react";

export default function GroupDetail() {
  const [, params] = useRoute("/groups/:id");
  const groupId = params?.id ?? "";
  const { data: group, isLoading } = useGetGroup(groupId, { query: { enabled: !!groupId } });

  if (isLoading) return <div className="space-y-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  if (!group) return <div className="py-16 text-center text-muted-foreground">Group not found</div>;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center gap-3">
        <Link href="/groups"><ArrowLeft className="h-5 w-5 text-muted-foreground cursor-pointer hover:text-foreground" /></Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{group.name}</h1>
          <p className="text-muted-foreground flex items-center gap-1 mt-1"><MapPin className="h-3 w-3" />{group.village}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total Members</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold flex items-center gap-2"><Users className="h-5 w-5 text-muted-foreground" />{group.memberCount ?? 0}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Active Plots</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{group.activePlots ?? 0}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Compliance Score</CardTitle></CardHeader><CardContent><div className={`text-2xl font-bold ${(group.complianceScore ?? 0) >= 0.8 ? "text-green-600" : "text-amber-600"}`}>{(((group.complianceScore ?? 0)) * 100).toFixed(0)}%</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Members</CardTitle></CardHeader>
        <CardContent>
          {group.members && group.members.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref #</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Village</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.members.map((m: any) => (
                  <TableRow key={m.id} data-testid={`member-row-${m.id}`}>
                    <TableCell className="font-mono text-sm">{m.referenceNumber}</TableCell>
                    <TableCell>
                      <Link href={`/farmers/${m.id}`} className="text-primary hover:underline">
                        {m.firstName} {m.lastName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.village ?? "-"}</TableCell>
                    <TableCell><Badge variant={m.status === "active" ? "default" : "secondary"}>{m.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="py-8 text-center text-muted-foreground">No members</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
