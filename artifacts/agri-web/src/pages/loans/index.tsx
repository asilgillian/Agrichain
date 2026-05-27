import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
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

interface LoanProduct {
  id: string;
  name: string;
  loanCategoryId: string;
  productType: "INPUT" | "CASH";
  defaultPrincipal: string | null;
  interestType: string;
  interestRate: string;
  penaltyRate: string;
  gracePeriodDays: number;
  maxAmount: string | null;
  allowFinanceOverride: boolean;
  isActive: boolean;
}

const emptyForm = {
  loanProductId: "",
  farmerId: "",
  principalAmount: "",
  interestOverride: "",
  purpose: "",
  collateral: "",
  dueDate: "",
  notes: "",
};

export default function LoansPage() {
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (status !== "all") params.set("status", status);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/loans", status, page],
    queryFn: () => fetch(`${API_BASE}/api/loans?${params}`).then(r => r.json()),
  });

  const { data: summary } = useQuery({
    queryKey: ["/api/loans/summary"],
    queryFn: () => fetch(`${API_BASE}/api/loans/summary`).then(r => r.json()),
  });

  const { data: farmersData } = useQuery({
    queryKey: ["/api/farmers/for-loan"],
    queryFn: () => fetch(`${API_BASE}/api/farmers?limit=200`).then(r => r.json()),
    enabled: open,
  });

  const { data: products } = useQuery<LoanProduct[]>({
    queryKey: ["/api/loan-products"],
    queryFn: () => fetch(`${API_BASE}/api/loan-products`).then(r => r.json()),
    enabled: open,
  });

  const activeProducts = useMemo(() => (products ?? []).filter(p => p.isActive), [products]);
  const selectedProduct = useMemo(
    () => activeProducts.find(p => p.id === form.loanProductId) ?? null,
    [activeProducts, form.loanProductId],
  );

  // When a new product is picked: clear any prior override AND, for INPUT
  // products, prefill the principal from the product's configured price so the
  // operator sees the exact amount that'll be issued.
  useEffect(() => {
    setForm(f => ({
      ...f,
      interestOverride: "",
      principalAmount: selectedProduct?.productType === "INPUT" && selectedProduct.defaultPrincipal
        ? String(Number(selectedProduct.defaultPrincipal))
        : selectedProduct?.productType === "CASH" ? "" : f.principalAmount,
    }));
  }, [form.loanProductId, selectedProduct?.productType, selectedProduct?.defaultPrincipal]);

  const isInputProduct = selectedProduct?.productType === "INPUT";

  const createMutation = useMutation({
    mutationFn: (body: any) => fetch(`${API_BASE}/api/loans`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/loans/summary"] });
      toast({ title: "Loan created" });
      setOpen(false); setForm(emptyForm);
    },
    onError: (e: any) => toast({ title: "Failed to create loan", description: e.message, variant: "destructive" }),
  });

  const submit = () => {
    if (!form.loanProductId) { toast({ title: "Please select a loan product", variant: "destructive" }); return; }
    // For INPUT loans, the server uses product.defaultPrincipal regardless of
    // what we send — but we still skip client-side validation since there's
    // nothing for the operator to enter.
    let principal: number | undefined;
    if (isInputProduct) {
      principal = undefined; // server-derived from product
    } else {
      principal = Number(form.principalAmount);
      if (!principal || principal <= 0) { toast({ title: "Valid principal amount required", variant: "destructive" }); return; }
      if (selectedProduct?.maxAmount && principal > Number(selectedProduct.maxAmount)) {
        toast({ title: `Exceeds product max (UGX ${Number(selectedProduct.maxAmount).toLocaleString()})`, variant: "destructive" });
        return;
      }
    }
    createMutation.mutate({
      loanProductId: form.loanProductId,
      farmerId: form.farmerId || undefined,
      principalAmount: principal,
      interestRatePctOverride: form.interestOverride ? Number(form.interestOverride) : undefined,
      purpose: form.purpose.trim() || undefined,
      collateral: form.collateral.trim() || undefined,
      dueDate: form.dueDate || undefined,
      notes: form.notes.trim() || undefined,
    });
  };

  const totalDisbursed = summary?.find((s: any) => s.status === "DISBURSED")?.totalOutstanding ?? 0;
  const totalRepaying = summary?.find((s: any) => s.status === "REPAYING")?.totalOutstanding ?? 0;
  const totalDefaulted = summary?.find((s: any) => s.status === "DEFAULTED")?.count ?? 0;
  const totalClosed = summary?.find((s: any) => s.status === "CLOSED")?.count ?? 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Loan Management</h1>
          <p className="text-muted-foreground mt-1">Farmer and group loans — backed by your loan-product catalog.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="new-loan-btn" className="gap-2"><Plus className="h-4 w-4" /> New Loan</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New Loan</DialogTitle>
              <DialogDescription>Pick a catalog product — its interest, grace and recovery rules apply automatically.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Loan Product *</Label>
                <Select value={form.loanProductId} onValueChange={v => setForm({ ...form, loanProductId: v })}>
                  <SelectTrigger data-testid="input-loan-product"><SelectValue placeholder={activeProducts.length === 0 ? "No active products — create one in Loan Products" : "Select a product"} /></SelectTrigger>
                  <SelectContent>
                    {activeProducts.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedProduct && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedProduct.productType === "INPUT"
                      ? <><span className="font-medium">Input loan</span> · price UGX {Number(selectedProduct.defaultPrincipal ?? 0).toLocaleString()} · </>
                      : <><span className="font-medium">Cash loan</span> · </>}
                    {selectedProduct.interestType} · default {Number(selectedProduct.interestRate)}% interest
                    · {selectedProduct.gracePeriodDays}d grace
                    {selectedProduct.maxAmount ? ` · max UGX ${Number(selectedProduct.maxAmount).toLocaleString()}` : ""}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Principal (UGX) {isInputProduct ? "(set by product)" : "*"}</Label>
                  <Input
                    type="number"
                    value={form.principalAmount}
                    onChange={e => setForm({ ...form, principalAmount: e.target.value })}
                    placeholder="50000"
                    disabled={isInputProduct}
                    data-testid="input-principal"
                  />
                </div>
                <div>
                  <Label>Interest % {selectedProduct?.allowFinanceOverride ? "" : "(locked)"}</Label>
                  <Input
                    type="number" step="0.1"
                    value={form.interestOverride}
                    placeholder={selectedProduct ? String(Number(selectedProduct.interestRate)) : "—"}
                    disabled={!selectedProduct?.allowFinanceOverride}
                    onChange={e => setForm({ ...form, interestOverride: e.target.value })}
                    data-testid="input-interest"
                  />
                </div>
              </div>
              <div>
                <Label>Farmer (optional for group loans)</Label>
                <Select value={form.farmerId || "none"} onValueChange={v => setForm({ ...form, farmerId: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="input-farmer"><SelectValue placeholder="Select farmer" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None (group loan) —</SelectItem>
                    {(farmersData?.data ?? []).map((f: any) => (
                      <SelectItem key={f.id} value={f.id}>{f.firstName} {f.lastName} ({f.referenceNumber})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} data-testid="input-due-date" />
              </div>
              <div><Label>Purpose</Label><Input value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} placeholder="e.g. School fees, fertilizer" data-testid="input-purpose" /></div>
              <div><Label>Collateral</Label><Input value={form.collateral} onChange={e => setForm({ ...form, collateral: e.target.value })} placeholder="e.g. Future harvest" data-testid="input-collateral" /></div>
              <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} data-testid="input-notes" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={createMutation.isPending} data-testid="submit-loan">{createMutation.isPending ? "Creating..." : "Create Loan"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Disbursed</p><p className="text-xl font-bold mt-1">UGX {Number(totalDisbursed).toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Repaying</p><p className="text-xl font-bold mt-1">UGX {Number(totalRepaying).toLocaleString()}</p></CardContent></Card>
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
            <SelectItem value="WRITTEN_OFF">Written Off</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Loan Number</TableHead>
              <TableHead>Farmer</TableHead>
              <TableHead>Product</TableHead>
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
                <TableCell><span className="text-xs">{loan.loanType}</span></TableCell>
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
