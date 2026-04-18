import { useListPayments, useGetPaymentSummary } from "@workspace/api-client-react";
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
  paid: "default",
  pending: "secondary",
  failed: "destructive",
};

export default function PaymentsPage() {
  const { data: payments, isLoading } = useListPayments({});
  const { data: summary, isLoading: isLoadingSummary } = useGetPaymentSummary();

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Farmer Payments</h1>
        <p className="text-muted-foreground mt-1">Payment status and disbursement tracker</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total Pending</CardTitle></CardHeader><CardContent>{isLoadingSummary ? <Skeleton className="h-7 w-24" /> : <div className="text-xl font-bold text-amber-600">{fmtKES(summary?.totalPending)}</div>}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total Paid</CardTitle></CardHeader><CardContent>{isLoadingSummary ? <Skeleton className="h-7 w-24" /> : <div className="text-xl font-bold text-green-600">{fmtKES(summary?.totalPaid)}</div>}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Pending Count</CardTitle></CardHeader><CardContent>{isLoadingSummary ? <Skeleton className="h-7 w-12" /> : <div className="text-xl font-bold">{summary?.pendingCount ?? 0}</div>}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Paid Count</CardTitle></CardHeader><CardContent>{isLoadingSummary ? <Skeleton className="h-7 w-12" /> : <div className="text-xl font-bold">{summary?.paidCount ?? 0}</div>}</CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Payment List</CardTitle>
            <Badge variant="secondary">{isLoading ? "..." : (payments?.length ?? 0)} records</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Farmer</TableHead>
                <TableHead>Amount Due</TableHead>
                <TableHead>Amount Paid</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7}><Skeleton className="h-12 w-full" /></TableCell></TableRow>
              ) : payments && payments.length > 0 ? payments.map(p => (
                <TableRow key={p.id} data-testid={`payment-row-${p.id}`}>
                  <TableCell className="font-medium">{(p as any).farmerName ?? "—"}</TableCell>
                  <TableCell>{fmtKES(p.amountDue)}</TableCell>
                  <TableCell>{p.amountPaid != null ? fmtKES(Number(p.amountPaid)) : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="capitalize">{p.paymentMethod}</TableCell>
                  <TableCell>{p.currency}</TableCell>
                  <TableCell><Badge variant={statusColors[p.status ?? ""] ?? "secondary"}>{p.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-sm">{format(new Date(p.createdAt), "MMM d, yyyy")}</TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={7} className="py-12 text-center text-muted-foreground">No payments found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
