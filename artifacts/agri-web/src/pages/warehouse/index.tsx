import { useListLots, useGetWarehouseMassBalance } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import { ChevronRight, Warehouse } from "lucide-react";

function fmtKg(v?: number | null) {
  if (v == null) return "-";
  return `${Number(v).toLocaleString()} kg`;
}

export default function WarehousePage() {
  const { data: lots, isLoading } = useListLots({});
  const { data: massBalance, isLoading: isLoadingMB } = useGetWarehouseMassBalance();

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Warehouse</h1>
        <p className="text-muted-foreground mt-1">Lot inventory, stream identity, and mass balance</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {["totalReceivedKg", "warehouseStockKg", "totalAllocatedKg", "totalExportedKg"].map(key => (
          <Card key={key}>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground capitalize">{key.replace(/([A-Z])/g, " $1").replace("Kg", " (kg)")}</CardTitle></CardHeader>
            <CardContent>{isLoadingMB ? <Skeleton className="h-7 w-20" /> : <div className="text-xl font-bold">{fmtKg((massBalance as any)?.[key])}</div>}</CardContent>
          </Card>
        ))}
      </div>

      {massBalance?.byStream && massBalance.byStream.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Mass Balance by Stream</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {massBalance.byStream.map((s: any) => (
                <div key={s.streamName} className="p-3 border rounded-lg">
                  <p className="font-medium text-sm">{s.streamName}</p>
                  <p className="text-muted-foreground text-xs">Stock</p>
                  <p className="font-bold">{fmtKg(s.stockKg)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Lot Inventory</CardTitle>
          <Badge variant="secondary">{isLoading ? "..." : (lots?.length ?? 0)} lots</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lot Tag</TableHead>
                <TableHead>Weight (kg)</TableHead>
                <TableHead>Streams</TableHead>
                <TableHead>Silo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6}><Skeleton className="h-12 w-full" /></TableCell></TableRow>
              ) : lots && lots.length > 0 ? lots.map(lot => (
                <TableRow key={lot.id} data-testid={`lot-row-${lot.id}`}>
                  <TableCell className="font-mono text-sm font-medium">{lot.lotTag}</TableCell>
                  <TableCell>{fmtKg(lot.weightKg)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {lot.certificationStreams?.map((s: string) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{lot.siloId ?? "—"}</TableCell>
                  <TableCell><Badge variant={lot.status === "received" ? "secondary" : "default"}>{lot.status}</Badge></TableCell>
                  <TableCell>
                    <Link href={`/warehouse/${lot.id}`}><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={6} className="py-12 text-center text-muted-foreground">No lots in warehouse</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
