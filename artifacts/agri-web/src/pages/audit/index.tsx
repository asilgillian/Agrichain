import { useListAuditLogs } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Shield } from "lucide-react";

const actionColors: Record<string, string> = {
  created: "text-green-600",
  updated: "text-blue-600",
  deleted: "text-destructive",
  approved: "text-green-600",
  rejected: "text-destructive",
  paid: "text-primary",
};

export default function AuditPage() {
  const { data: result, isLoading } = useListAuditLogs({ page: 1, limit: 50 });
  const logs = (result as any)?.data ?? result ?? [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
          <p className="text-muted-foreground mt-1">Immutable record of all system events</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity Type</TableHead>
                <TableHead>Entity ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3].map(i => <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-10 w-full" /></TableCell></TableRow>)
              ) : logs.length > 0 ? logs.map((log: any) => (
                <TableRow key={log.id} data-testid={`audit-row-${log.id}`}>
                  <TableCell className="text-muted-foreground text-sm font-mono whitespace-nowrap">{format(new Date(log.timestamp), "MMM d, yyyy HH:mm:ss")}</TableCell>
                  <TableCell className="font-medium">{log.actorName}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs capitalize">{log.actorRole}</Badge></TableCell>
                  <TableCell>
                    <span className={`font-medium capitalize ${actionColors[log.action] ?? ""}`}>{log.action}</span>
                  </TableCell>
                  <TableCell className="capitalize">{log.entityType}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-32">{log.entityId}</TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={6} className="py-12 text-center text-muted-foreground">No audit records</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
