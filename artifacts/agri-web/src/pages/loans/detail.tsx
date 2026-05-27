import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, RefreshCw, FileX } from "lucide-react";
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
  return "UGX " + Number(n).toLocaleString("en-UG", { minimumFractionDigits: 0 });
}

const emptyRepay = { amount: "", paymentDate: new Date().toISOString().slice(0, 10), paymentMethod: "MTN_MOMO", reference: "" };
const emptyRestructure = { newDueDate: "", additionalInterest: "", reason: "" };
const emptyWriteOff = { reason: "" };

async function postJson(url: string, body: any) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
  return r.json();
}

export default function LoanDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [repayOpen, setRepayOpen] = useState(false);
  const [repayForm, setRepayForm] = useState(emptyRepay);
  const [restructureOpen, setRestructureOpen] = useState(false);
  const [restructureForm, setRestructureForm] = useState(emptyRestructure);
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [writeOffForm, setWriteOffForm] = useState(emptyWriteOff);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/loans", id] });

  const { data: loan, isLoading } = useQuery({
    queryKey: ["/api/loans", id],
    queryFn: () => fetch(`${API_BASE}/api/loans/${id}`).then(r => r.json()),
    enabled: !!id,
  });

  const approveMutation = useMutation({
    mutationFn: () => postJson(`${API_BASE}/api/loans/${id}/approve`, {}),
    onSuccess: () => { invalidate(); toast({ title: "Loan approved" }); },
    onError: (e: any) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const disburseMutation = useMutation({
    mutationFn: () => postJson(`${API_BASE}/api/loans/${id}/disburse`, { disbursedAmount: Number(loan?.principalAmount ?? 0) }),
    onSuccess: () => { invalidate(); toast({ title: "Loan disbursed" }); },
    onError: (e: any) => toast({ title: "Disburse failed", description: e.message, variant: "destructive" }),
  });

  const repayMutation = useMutation({
    mutationFn: (body: any) => postJson(`${API_BASE}/api/loans/${id}/repayments`, body),
    onSuccess: () => { invalidate(); toast({ title: "Repayment recorded" }); setRepayOpen(false); setRepayForm(emptyRepay); },
    onError: (e: any) => toast({ title: "Failed to record repayment", description: e.message, variant: "destructive" }),
  });

  const restructureMutation = useMutation({
    mutationFn: (body: any) => postJson(`${API_BASE}/api/loans/${id}/restructure`, body),
    onSuccess: () => { invalidate(); toast({ title: "Loan restructured" }); setRestructureOpen(false); setRestructureForm(emptyRestructure); },
    onError: (e: any) => toast({ title: "Restructure failed", description: e.message, variant: "destructive" }),
  });

  const writeOffMutation = useMutation({
    mutationFn: (body: any) => postJson(`${API_BASE}/api/loans/${id}/write-off`, body),
    onSuccess: () => { invalidate(); toast({ title: "Loan written off" }); setWriteOffOpen(false); setWriteOffForm(emptyWriteOff); },
    onError: (e: any) => toast({ title: "Write-off failed", description: e.message, variant: "destructive" }),
  });

  const submitRepay = () => {
    if (!repayForm.amount || Number(repayForm.amount) <= 0) { toast({ title: "Valid amount required", variant: "destructive" }); return; }
    repayMutation.mutate({
      amount: Number(repayForm.amount),
      paymentDate: repayForm.paymentDate,
      paymentMethod: repayForm.paymentMethod,
      reference: repayForm.reference.trim() || undefined,
    });
  };

  const submitRestructure = () => {
    if (!restructureForm.newDueDate) { toast({ title: "New due date required", variant: "destructive" }); return; }
    if (!restructureForm.reason.trim()) { toast({ title: "Reason required", variant: "destructive" }); return; }
    restructureMutation.mutate({
      newDueDate: restructureForm.newDueDate,
      additionalInterest: restructureForm.additionalInterest ? Number(restructureForm.additionalInterest) : undefined,
      reason: restructureForm.reason.trim(),
    });
  };

  const submitWriteOff = () => {
    if (!writeOffForm.reason.trim()) { toast({ title: "Reason required", variant: "destructive" }); return; }
    writeOffMutation.mutate({ reason: writeOffForm.reason.trim() });
  };

  if (isLoading) return <div className="p-8 space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-48 w-full" /></div>;
  if (!loan || loan.error) return <div className="p-8 text-center text-muted-foreground">Loan not found</div>;

  const repaid = loan.repayments?.reduce((s: number, r: any) => s + Number(r.amount), 0) ?? 0;
  const principal = Number(loan.principalAmount ?? 0);
  const outstanding = Number(loan.outstandingBalance ?? 0);
  const progress = principal > 0 ? Math.round(((principal - outstanding) / principal) * 100) : 0;
  const isOpen = ["DISBURSED", "REPAYING", "DEFAULTED"].includes(loan.status);
  const canRepay = ["DISBURSED", "REPAYING"].includes(loan.status);
  const isTerminal = ["CLOSED", "WRITTEN_OFF"].includes(loan.status);
  const restructuresLeft = loan.product ? Math.max(0, (loan.product.maxRestructures ?? 0) - (loan.restructureCount ?? 0)) : 0;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{loan.loanNumber}</h1>
          <p className="text-muted-foreground">{loan.loanType} {loan.farmer ? `· ${loan.farmer.firstName} ${loan.farmer.lastName}` : ""}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`${statusColors[loan.status] ?? ""} border-0 text-sm`}>{loan.status}</Badge>
          {loan.status === "PENDING" && <Button size="sm" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending} data-testid="approve-btn">Approve</Button>}
          {loan.status === "APPROVED" && <Button size="sm" onClick={() => disburseMutation.mutate()} disabled={disburseMutation.isPending} data-testid="disburse-btn">Disburse</Button>}
          {isOpen && !isTerminal && (
            <Dialog open={restructureOpen} onOpenChange={setRestructureOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1" data-testid="restructure-btn" disabled={loan.product && restructuresLeft === 0}>
                  <RefreshCw className="h-3.5 w-3.5" /> Restructure
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Restructure Loan</DialogTitle>
                  <DialogDescription>
                    {loan.product ? `${restructuresLeft} restructure(s) remaining (max ${loan.product.maxRestructures ?? 0}).` : "Extend the due date and optionally capitalize accrued interest."}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div><Label>New Due Date *</Label><Input type="date" value={restructureForm.newDueDate} onChange={e => setRestructureForm({ ...restructureForm, newDueDate: e.target.value })} data-testid="input-new-due-date" /></div>
                  <div><Label>Additional Interest (UGX, optional)</Label><Input type="number" placeholder="0" value={restructureForm.additionalInterest} onChange={e => setRestructureForm({ ...restructureForm, additionalInterest: e.target.value })} data-testid="input-additional-interest" /></div>
                  <div><Label>Reason *</Label><Textarea rows={3} value={restructureForm.reason} onChange={e => setRestructureForm({ ...restructureForm, reason: e.target.value })} placeholder="Drought; farmer requested 60-day extension" data-testid="input-restructure-reason" /></div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRestructureOpen(false)}>Cancel</Button>
                  <Button onClick={submitRestructure} disabled={restructureMutation.isPending} data-testid="submit-restructure">{restructureMutation.isPending ? "Saving..." : "Restructure"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {isOpen && !isTerminal && (
            <Dialog open={writeOffOpen} onOpenChange={setWriteOffOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="destructive" className="gap-1" data-testid="write-off-btn">
                  <FileX className="h-3.5 w-3.5" /> Write Off
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Write Off Loan</DialogTitle>
                  <DialogDescription>This marks the outstanding balance as uncollectable. Cannot be undone.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div><Label>Reason *</Label><Textarea rows={4} value={writeOffForm.reason} onChange={e => setWriteOffForm({ ...writeOffForm, reason: e.target.value })} placeholder="Farmer deceased / unrecoverable after 3 collection attempts" data-testid="input-writeoff-reason" /></div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setWriteOffOpen(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={submitWriteOff} disabled={writeOffMutation.isPending} data-testid="submit-writeoff">{writeOffMutation.isPending ? "Saving..." : "Confirm Write-Off"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
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
              ["Product", loan.product?.name ?? loan.loanType],
              ["Purpose", loan.purpose],
              ["Collateral", loan.collateral],
              ["Interest Rate", loan.interestRatePct ? `${loan.interestRatePct}% (${loan.product?.interestType ?? "flat"})` : null],
              ["Penalty Rate", loan.penaltyRatePct && Number(loan.penaltyRatePct) > 0 ? `${loan.penaltyRatePct}%` : null],
              ["Grace Period", loan.gracePeriodDays ? `${loan.gracePeriodDays} days` : null],
              ["Recovery Method", loan.product?.repaymentMethod ?? null],
              ["Due Date", loan.dueDate],
              ["Original Due Date", loan.originalDueDate !== loan.dueDate ? loan.originalDueDate : null],
              ["Restructured", loan.restructureCount > 0 ? `${loan.restructureCount} time(s)` : null],
              ["Disbursed At", loan.disbursedAt ? new Date(loan.disbursedAt).toLocaleDateString() : null],
              ["Defaulted At", loan.defaultedAt ? new Date(loan.defaultedAt).toLocaleDateString() : null],
              ["Written Off At", loan.writtenOffAt ? new Date(loan.writtenOffAt).toLocaleDateString() : null],
              ["Write-Off Reason", loan.writeOffReason],
            ].map(([label, value]) => value ? (
              <div key={String(label)} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium text-right max-w-[60%]">{String(value)}</span>
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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Repayment History</CardTitle>
          {canRepay && (
            <Dialog open={repayOpen} onOpenChange={setRepayOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2" data-testid="add-repayment-btn"><Plus className="h-4 w-4" /> Add Repayment</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Record Repayment</DialogTitle>
                  <DialogDescription>Outstanding balance: {fmt(loan.outstandingBalance)}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div><Label>Amount (UGX) *</Label><Input type="number" value={repayForm.amount} onChange={e => setRepayForm({ ...repayForm, amount: e.target.value })} placeholder="100000" data-testid="input-amount" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Payment Date</Label><Input type="date" value={repayForm.paymentDate} onChange={e => setRepayForm({ ...repayForm, paymentDate: e.target.value })} data-testid="input-date" /></div>
                    <div>
                      <Label>Method</Label>
                      <Select value={repayForm.paymentMethod} onValueChange={v => setRepayForm({ ...repayForm, paymentMethod: v })}>
                        <SelectTrigger data-testid="input-method"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MTN_MOMO">MTN Mobile Money</SelectItem>
                          <SelectItem value="AIRTEL_MONEY">Airtel Money</SelectItem>
                          <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                          <SelectItem value="CASH">Cash</SelectItem>
                          <SelectItem value="CROP_DEDUCTION">Crop Deduction</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div><Label>Reference</Label><Input value={repayForm.reference} onChange={e => setRepayForm({ ...repayForm, reference: e.target.value })} placeholder="MoMo code or txn ref" data-testid="input-ref" /></div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRepayOpen(false)}>Cancel</Button>
                  <Button onClick={submitRepay} disabled={repayMutation.isPending} data-testid="submit-repayment">{repayMutation.isPending ? "Saving..." : "Record"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
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
