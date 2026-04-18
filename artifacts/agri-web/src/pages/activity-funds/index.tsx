import { useListActivityFunds } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

function fmtKES(v?: number | null) {
  if (v == null) return "-";
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(Number(v));
}

const statusColors: Record<string, "default" | "secondary" | "destructive"> = {
  approved: "default",
  pending: "secondary",
  rejected: "destructive",
  disbursed: "default",
};

export default function ActivityFundsPage() {
  const { data: funds, isLoading } = useListActivityFunds({});

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Activity Funds</h1>
          <p className="text-muted-foreground mt-1">Field agent activity fund requests and approvals</p>
        </div>
        <Badge variant="secondary">{isLoading ? "..." : (funds?.length ?? 0)} requests</Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Activity Type</TableHead>
                <TableHead>Planned Date</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Estimated</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2].map(i => <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-10 w-full" /></TableCell></TableRow>)
              ) : funds && funds.length > 0 ? funds.map(f => (
                <TableRow key={f.id} data-testid={`fund-row-${f.id}`}>
                  <TableCell className="font-medium">{(f as any).agentName ?? "—"}</TableCell>
                  <TableCell className="capitalize">{(f.activityType ?? "").replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-muted-foreground">{format(new Date(f.plannedDate), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-muted-foreground">{f.destination ?? "—"}</TableCell>
                  <TableCell>{fmtKES(f.estimatedAmount)}</TableCell>
                  <TableCell>{f.approvedAmount != null ? fmtKES(Number(f.approvedAmount)) : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell><Badge variant={statusColors[f.status ?? ""] ?? "secondary"}>{f.status}</Badge></TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={7} className="py-12 text-center text-muted-foreground">No fund requests</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
