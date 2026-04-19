import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, DollarSign, TrendingDown, AlertCircle, CheckCircle2 } from "lucide-react";

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

export default function LoansPage() {
  const [status, setStatus] = useState("all");
  const [loanType, setLoanType] = useState("all");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (status !== "all") params.set("status", status);
  if (loanType !== "all") params.set("loanType", loanType);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/loans", status, loanType, page],
    queryFn: () => fetch(`${API_BASE}/api/loans?${params}`).then(r => r.json()),
  });

  const { data: summary } = useQuery({
    queryKey: ["/api/loans/summary"],
    queryFn: () => fetch(`${API_BASE}/api/loans/summary`).then(r => r.json()),
  });

  const totalDisbursed = summary?.find((s: any) => s.status === "DISBURSED")?.totalOutstanding ?? 0;
  const totalRepaying = summary?.find((s: any) => s.status === "REPAYING")?.totalOutstanding ?? 0;
  const totalDefaulted = summary?.find((s: any) => s.status === "DEFAULTED")?.count ?? 0;
  const totalClosed = summary?.find((s: any) => s.status === "CLOSED")?.count ?? 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Loan Management</h1>
          <p className="text-muted-foreground mt-1">Farmer and group loans — cash advances, input loans, and welfare.</p>
        </div>
        <Button data-testid="new-loan-btn" className="gap-2"><Plus className="h-4 w-4" /> New Loan</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Disbursed</p><p className="text-xl font-bold mt-1">KES {Number(totalDisbursed).toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Repaying</p><p className="text-xl font-bold mt-1">KES {Number(totalRepaying).toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Defaulted</p><p className="text-xl font-bold text-red-600 mt-1">{totalDefaulted}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Closed</p><p className="text-xl font-bold text-green-600 mt-1">{totalClosed}</p></CardContent></Card>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-40" data-testid="status-filter"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="DISBURSED">Disbursed</SelectItem>
            <SelectItem value="REPAYING">Repaying</SelectItem>
            <SelectItem value="CLOSED">Closed</SelectItem>
            <SelectItem value="DEFAULTED">Defaulted</SelectItem>
          </SelectContent>
        </Select>
        <Select value={loanType} onValueChange={v => { setLoanType(v); setPage(1); }}>
          <SelectTrigger className="w-44" data-testid="type-filter"><SelectValue placeholder="Loan Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="CASH_ADVANCE">Cash Advance</SelectItem>
            <SelectItem value="INPUT_LOAN">Input Loan</SelectItem>
            <SelectItem value="EMERGENCY_WELFARE">Emergency / Welfare</SelectItem>
            <SelectItem value="GROUP_LOAN">Group Loan</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Loan Number</TableHead>
              <TableHead>Farmer</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Principal</TableHead>
              <TableHead>Outstanding</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
            )) : (data?.data?.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No loans found</TableCell></TableRow>
            ) : data?.data?.map((loan: any) => (
              <TableRow key={loan.id} data-testid={`loan-row-${loan.id}`}>
                <TableCell className="font-mono text-sm font-semibold">{loan.loanNumber}</TableCell>
                <TableCell>{loan.farmerName ?? <span className="text-muted-foreground">Group Loan</span>}</TableCell>
                <TableCell><span className="text-xs">{loan.loanType.replace(/_/g, " ")}</span></TableCell>
                <TableCell className="font-mono">{fmt(loan.principalAmount)}</TableCell>
                <TableCell className="font-mono">{fmt(loan.outstandingBalance)}</TableCell>
                <TableCell className="text-sm">{loan.dueDate ?? "—"}</TableCell>
                <TableCell><Badge className={`${statusColors[loan.status] ?? ""} border-0`}>{loan.status}</Badge></TableCell>
                <TableCell><Link href={`/loans/${loan.id}`}><Button size="sm" variant="ghost">View</Button></Link></TableCell>
              </TableRow>
            )))}
          </TableBody>
        </Table>
      </Card>

      {data && data.total > 20 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
          <span className="flex items-center text-sm text-muted-foreground px-2">Page {page} of {Math.ceil(data.total / 20)}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
        </div>
      )}
    </div>
  );
}
