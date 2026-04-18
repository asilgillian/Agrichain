import { useListAssets } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { format } from "date-fns";

function fmtKES(v?: number | null) {
  if (v == null) return "-";
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(Number(v));
}

export default function AssetsPage() {
  const { data: assets, isLoading } = useListAssets({});

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Asset Registry</h1>
          <p className="text-muted-foreground mt-1">Equipment, devices, and field assets</p>
        </div>
        <Badge variant="secondary">{isLoading ? "..." : (assets?.length ?? 0)} assets</Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Make / Model</TableHead>
                <TableHead>Serial #</TableHead>
                <TableHead>Purchase Value</TableHead>
                <TableHead>Book Value</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3].map(i => <TableRow key={i}><TableCell colSpan={9}><Skeleton className="h-10 w-full" /></TableCell></TableRow>)
              ) : assets && assets.length > 0 ? assets.map(a => (
                <TableRow key={a.id} data-testid={`asset-row-${a.id}`}>
                  <TableCell className="font-mono text-sm font-medium">{a.assetCode}</TableCell>
                  <TableCell className="capitalize">{a.type}</TableCell>
                  <TableCell className="text-muted-foreground">{a.make} {a.model}</TableCell>
                  <TableCell className="font-mono text-sm">{a.serialNumber ?? "—"}</TableCell>
                  <TableCell>{fmtKES(a.purchaseValue)}</TableCell>
                  <TableCell>{fmtKES(a.currentBookValue)}</TableCell>
                  <TableCell className="text-muted-foreground">{(a as any).assignedToName ?? <span className="italic">Unassigned</span>}</TableCell>
                  <TableCell><Badge variant={a.status === "available" ? "secondary" : "default"}>{a.status}</Badge></TableCell>
                  <TableCell>
                    <Link href={`/assets/${a.id}`}><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={9} className="py-12 text-center text-muted-foreground">No assets found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
