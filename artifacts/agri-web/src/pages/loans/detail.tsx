import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, DollarSign, Clock, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

const statusColors: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-blue-100 text-blue-800",
  DISBURSED: "bg-indigo-100 text-indigo-800",
  REPAYING: "bg-cyan-100 text-cyan-800",
  CLOSED: "bg-green-100 text-green-800",
  DEFAULTED: "bg-red-100 text-red-800",
  WRITTEN_OFF: "bg-gray-100 text-gray-800",
};

function fmt(n: string | null | undefined) {
  if (!n) return "—";
  return "KES " + Number(n).toLocaleString("en-KE", { minimumFractionDigits: 0 });
}

export default function LoanDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: loan, isLoading } = useQuery({
    queryKey: ["/api/loans", id],
    queryFn: () => fetch(`${API_BASE}/api/loans/${id}`).then(r => r.json()),
    enabled: !!id,
  });

  const approveMutation = useMutation({
    mutationFn: () => fetch(`${API_BASE}/api/loans/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: null }) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/loans", id] }); toast({ title: "Loan approved" }); },
  });

  const disburseMutation = useMutation({
    mutationFn: () => fetch(`${API_BASE}/api/loans/${id}/disburse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disbursedAmount: loan?.principalAmount }) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/loans", id] }); toast({ title: "Loan disbursed" }); },
  });

  if (isLoading) return <div className="p-8 space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-48 w-full" /></div>;
  if (!loan || loan.error) return <div className="p-8 text-center text-muted-foreground">Loan not found</div>;

  const repaid = loan.repayments?.reduce((s: number, r: any) => s + Number(r.amount), 0) ?? 0;
  const principal = Number(loan.principalAmount ?? 0);
  const outstanding = Number(loan.outstandingBalance ?? 0);
  const progress = principal > 0 ? Math.round(((principal - outstanding) / principal) * 100) : 0;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{loan.loanNumber}</h1>
          <p className="text-muted-foreground">{loan.loanType?.replace(/_/g, " ")} {loan.farmer ? `· ${loan.farmer.firstName} ${loan.farmer.lastName}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={`${statusColors[loan.status] ?? ""} border-0 text-sm`}>{loan.status}</Badge>
          {loan.status === "PENDING" && <Button size="sm" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending} data-testid="approve-btn">Approve</Button>}
          {loan.status === "APPROVED" && <Button size="sm" onClick={() => disburseMutation.mutate()} disabled={disburseMutation.isPending} data-testid="disburse-btn">Disburse</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground uppercase tracking-wide">Principal</p><p className="text-xl font-bold mt-1">{fmt(loan.principalAmount)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground uppercase tracking-wide">Total Repayable</p><p className="text-xl font-bold mt-1">{fmt(loan.totalRepayable)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground uppercase tracking-wide">Outstanding</p><p className="text-xl font-bold text-orange-600 mt-1">{fmt(loan.outstandingBalance)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground uppercase tracking-wide">Repaid</p><p className="text-xl font-bold text-green-600 mt-1">{fmt(String(repaid))}</p></CardContent></Card>
      </div>

      {principal > 0 && (
        <Card>
          <CardContent className="pt-5">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Repayment Progress</span>
              <span className="font-semibold">{progress}%</span>
            </div>
            <div className="w-full h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Loan Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {[
              ["Purpose", loan.purpose],
              ["Collateral", loan.collateral],
              ["Interest Rate", loan.interestRatePct ? `${loan.interestRatePct}%` : null],
              ["Due Date", loan.dueDate],
              ["Disbursed At", loan.disbursedAt ? new Date(loan.disbursedAt).toLocaleDateString() : null],
            ].map(([label, value]) => value ? (
              <div key={String(label)} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium">{String(value)}</span>
              </div>
            ) : null)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Farmer / Group</CardTitle></CardHeader>
          <CardContent>
            {loan.farmer ? (
              <div className="space-y-2">
                <p className="font-semibold">{loan.farmer.firstName} {loan.farmer.lastName}</p>
                <p className="text-sm text-muted-foreground">{loan.farmer.referenceNumber}</p>
                {loan.farmer.phoneNumber && <p className="text-sm">{loan.farmer.phoneNumber}</p>}
              </div>
            ) : <p className="text-sm text-muted-foreground">Group loan (no individual farmer)</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Repayment History</CardTitle></CardHeader>
        <CardContent>
          {loan.repayments?.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No repayments recorded</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loan.repayments?.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.paymentDate}</TableCell>
                    <TableCell className="font-mono font-semibold">{fmt(r.amount)}</TableCell>
                    <TableCell>{r.paymentMethod ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{r.reference ?? "—"}</TableCell>
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
