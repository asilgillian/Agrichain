import { useListDeliveries } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import { ChevronRight, CheckCircle, Circle, XCircle } from "lucide-react";

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending_weight: "secondary",
  pending_qc: "secondary",
  pending_pricing: "outline",
  pending_approval: "outline",
  approved: "default",
  rejected: "destructive",
};

const statusLabels: Record<string, string> = {
  pending_weight: "Awaiting Weight",
  pending_qc: "Awaiting QC",
  pending_pricing: "Awaiting Pricing",
  pending_approval: "Awaiting Approval",
  approved: "Approved",
  rejected: "Rejected",
};

function Checkmark({ ok }: { ok: boolean }) {
  return ok ? <CheckCircle className="h-4 w-4 text-green-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />;
}

export default function ProcurementHub() {
  const { data: deliveries, isLoading } = useListDeliveries({});

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Procurement Hub</h1>
          <p className="text-muted-foreground mt-1">Inbound deliveries — weight, QC, pricing, and approval workflow</p>
        </div>
        <Badge variant="secondary">{isLoading ? "..." : (deliveries?.length ?? 0)} deliveries</Badge>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lot Tag</TableHead>
                  <TableHead>Net Weight (kg)</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead className="text-center">Weight</TableHead>
                  <TableHead className="text-center">QC</TableHead>
                  <TableHead>Price/kg</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries && deliveries.length > 0 ? deliveries.map((d) => (
                  <TableRow key={d.id} className="cursor-pointer" data-testid={`delivery-row-${d.id}`}>
                    <TableCell className="font-mono text-sm font-medium">{d.lotTag}</TableCell>
                    <TableCell>{d.netWeightKg != null ? Number(d.netWeightKg).toLocaleString() : <span className="text-muted-foreground text-sm">—</span>}</TableCell>
                    <TableCell>{d.grade ?? <span className="text-muted-foreground text-sm">—</span>}</TableCell>
                    <TableCell className="text-center"><Checkmark ok={d.weightApproved ?? false} /></TableCell>
                    <TableCell className="text-center"><Checkmark ok={d.qcApproved ?? false} /></TableCell>
                    <TableCell>{d.pricePerKg != null ? `UGX ${Number(d.pricePerKg).toLocaleString()}` : <span className="text-muted-foreground text-sm">—</span>}</TableCell>
                    <TableCell><Badge variant={statusColors[d.status ?? ""] ?? "secondary"}>{statusLabels[d.status ?? ""] ?? d.status}</Badge></TableCell>
                    <TableCell>
                      <Link href={`/procurement/${d.id}`}><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={8} className="py-12 text-center text-muted-foreground">No deliveries found</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
