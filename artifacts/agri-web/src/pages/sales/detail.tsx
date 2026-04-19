import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Globe, CheckCircle2, Package, Truck, Receipt } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

const statusColors: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  APPROVED: "bg-blue-100 text-blue-800",
  STOCK_ALLOCATED: "bg-indigo-100 text-indigo-800",
  PARTIALLY_FULFILLED: "bg-yellow-100 text-yellow-800",
  FULLY_FULFILLED: "bg-green-100 text-green-800",
  CLOSED: "bg-gray-200 text-gray-600",
  CANCELLED: "bg-red-100 text-red-700",
};

export default function SalesContractDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: contract, isLoading } = useQuery({
    queryKey: ["/api/sales/contracts", id],
    queryFn: () => fetch(`${API_BASE}/api/sales/contracts/${id}`).then(r => r.json()),
    enabled: !!id,
  });

  const approveMutation = useMutation({
    mutationFn: () => fetch(`${API_BASE}/api/sales/contracts/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/sales/contracts", id] }); toast({ title: "Contract approved" }); },
  });

  if (isLoading) return <div className="p-8 space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (!contract || contract.error) return <div className="p-8 text-center text-muted-foreground">Contract not found</div>;

  const allocatedKg = contract.allocations?.reduce((s: number, a: any) => s + Number(a.allocatedWeightKg ?? 0), 0) ?? 0;
  const targetKg = Number(contract.targetQuantityKg ?? 0);
  const fulfillmentPct = targetKg > 0 ? Math.round((allocatedKg / targetKg) * 100) : 0;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{contract.contractNumber}</h1>
          <p className="text-muted-foreground">{contract.contractType} · {contract.commodityType ?? "Commodity TBD"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={`${statusColors[contract.status] ?? ""} border-0 text-sm`}>{contract.status.replace(/_/g, " ")}</Badge>
          {contract.status === "DRAFT" && <Button size="sm" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending} data-testid="approve-btn">Approve</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground uppercase">Target</p><p className="text-xl font-bold mt-1">{targetKg ? `${targetKg.toLocaleString()} kg` : "—"}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground uppercase">Allocated</p><p className="text-xl font-bold mt-1">{allocatedKg.toLocaleString()} kg</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground uppercase">Price/kg</p><p className="text-xl font-bold mt-1">{contract.agreedPricePerKg ? `${contract.currency} ${Number(contract.agreedPricePerKg).toFixed(2)}` : "—"}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground uppercase">Fulfillment</p><p className="text-xl font-bold text-green-600 mt-1">{fulfillmentPct}%</p></CardContent></Card>
      </div>

      {targetKg > 0 && (
        <Card>
          <CardContent className="pt-5">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Allocation Progress</span>
              <span className="font-semibold">{allocatedKg.toLocaleString()} / {targetKg.toLocaleString()} kg</span>
            </div>
            <div className="w-full h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, fulfillmentPct)}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Globe className="h-4 w-4" />Buyer</CardTitle></CardHeader>
          <CardContent>
            {contract.buyer ? (
              <div className="space-y-1">
                <p className="font-semibold">{contract.buyer.name}</p>
                {contract.buyer.country && <p className="text-sm text-muted-foreground">{contract.buyer.country}</p>}
                {contract.buyer.contactName && <p className="text-sm">{contract.buyer.contactName}</p>}
                {contract.buyer.contactEmail && <p className="text-sm text-muted-foreground">{contract.buyer.contactEmail}</p>}
              </div>
            ) : <p className="text-sm text-muted-foreground">No buyer info</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Contract Terms</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {[
              ["Grade", contract.grade],
              ["Incoterms", contract.incoterms],
              ["Certification Required", contract.certificationRequired],
              ["Delivery Window Start", contract.deliveryWindowStart],
              ["Delivery Window End", contract.deliveryWindowEnd],
            ].map(([label, value]) => value ? (
              <div key={String(label)} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium">{String(value)}</span>
              </div>
            ) : null)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Package className="h-4 w-4" />Lot Allocations ({contract.allocations?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {contract.allocations?.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No lots allocated to this contract yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lot ID</TableHead>
                  <TableHead>Allocated Weight (kg)</TableHead>
                  <TableHead>Allocated At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contract.allocations?.map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">{a.lotId}</TableCell>
                    <TableCell className="font-mono">{Number(a.allocatedWeightKg).toLocaleString()}</TableCell>
                    <TableCell className="text-sm">{new Date(a.allocatedAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" />Invoices ({contract.invoices?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {contract.invoices?.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No invoices issued yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice No.</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contract.invoices?.map((inv: any) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono font-semibold">{inv.invoiceNumber}</TableCell>
                    <TableCell className="font-mono">{inv.totalAmount ? Number(inv.totalAmount).toLocaleString() : "—"}</TableCell>
                    <TableCell>{inv.currency}</TableCell>
                    <TableCell>{inv.dueDate ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{inv.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
