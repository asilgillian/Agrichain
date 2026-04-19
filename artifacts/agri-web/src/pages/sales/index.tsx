import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, FileText, Package, Truck, Receipt } from "lucide-react";

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

export default function SalesPage() {
  const [status, setStatus] = useState("all");
  const [tab, setTab] = useState<"contracts" | "dispatches" | "invoices">("contracts");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (status !== "all") params.set("status", status);

  const { data: contracts, isLoading: contractsLoading } = useQuery({
    queryKey: ["/api/sales/contracts", status, page],
    queryFn: () => fetch(`${API_BASE}/api/sales/contracts?${params}`).then(r => r.json()),
    enabled: tab === "contracts",
  });

  const { data: dispatches, isLoading: dispatchesLoading } = useQuery({
    queryKey: ["/api/dispatches"],
    queryFn: () => fetch(`${API_BASE}/api/dispatches?limit=20&page=${page}`).then(r => r.json()),
    enabled: tab === "dispatches",
  });

  const { data: invoices, isLoading: invoicesLoading } = useQuery({
    queryKey: ["/api/invoices"],
    queryFn: () => fetch(`${API_BASE}/api/invoices?limit=20&page=${page}`).then(r => r.json()),
    enabled: tab === "invoices",
  });

  const tabs = [
    { key: "contracts", label: "Contracts", icon: FileText },
    { key: "dispatches", label: "Dispatches", icon: Truck },
    { key: "invoices", label: "Invoices", icon: Receipt },
  ] as const;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sales & Commodity Exit</h1>
          <p className="text-muted-foreground mt-1">Buyer contracts, dispatch management, and invoice tracking.</p>
        </div>
        <Button data-testid="new-contract-btn" className="gap-2"><Plus className="h-4 w-4" /> New Contract</Button>
      </div>

      <div className="flex gap-1 border-b">
        {tabs.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setPage(1); }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            data-testid={`tab-${t.key}`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {tab === "contracts" && (
        <>
          <div className="flex gap-3">
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-48" data-testid="status-filter"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.keys(statusColors).map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contract No.</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Commodity</TableHead>
                  <TableHead>Target (kg)</TableHead>
                  <TableHead>Price/kg</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {contractsLoading ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                )) : contracts?.data?.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No contracts found</TableCell></TableRow>
                ) : contracts?.data?.map((c: any) => (
                  <TableRow key={c.id} data-testid={`contract-row-${c.id}`}>
                    <TableCell className="font-mono text-sm font-semibold">{c.contractNumber}</TableCell>
                    <TableCell>{c.buyerName ?? "—"}</TableCell>
                    <TableCell className="text-xs">{c.contractType}</TableCell>
                    <TableCell>{c.commodityType ?? "—"}</TableCell>
                    <TableCell className="font-mono">{c.targetQuantityKg ? Number(c.targetQuantityKg).toLocaleString() : "—"}</TableCell>
                    <TableCell className="font-mono">{c.agreedPricePerKg ? `${c.currency ?? "USD"} ${Number(c.agreedPricePerKg).toFixed(2)}` : "—"}</TableCell>
                    <TableCell><Badge className={`${statusColors[c.status] ?? ""} border-0 text-xs`}>{c.status.replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell><Link href={`/sales/${c.id}`}><Button size="sm" variant="ghost">View</Button></Link></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {tab === "dispatches" && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dispatch No.</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Truck Reg</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Weight (kg)</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dispatchesLoading ? Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
              )) : dispatches?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No dispatches found</TableCell></TableRow>
              ) : dispatches?.data?.map((d: any) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono font-semibold">{d.dispatchNumber}</TableCell>
                  <TableCell>{d.containerNumber ?? "—"}</TableCell>
                  <TableCell>{d.truckReg ?? "—"}</TableCell>
                  <TableCell>{d.driverName ?? "—"}</TableCell>
                  <TableCell className="font-mono">{d.dispatchWeightKg ? Number(d.dispatchWeightKg).toLocaleString() : "—"}</TableCell>
                  <TableCell><Badge variant="outline">{d.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {tab === "invoices" && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice No.</TableHead>
                <TableHead>Weight (kg)</TableHead>
                <TableHead>Price/kg</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoicesLoading ? Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
              )) : invoices?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No invoices found</TableCell></TableRow>
              ) : invoices?.data?.map((inv: any) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono font-semibold">{inv.invoiceNumber}</TableCell>
                  <TableCell className="font-mono">{inv.dispatchWeightKg ? Number(inv.dispatchWeightKg).toLocaleString() : "—"}</TableCell>
                  <TableCell className="font-mono">{inv.pricePerKg ? Number(inv.pricePerKg).toFixed(2) : "—"}</TableCell>
                  <TableCell className="font-mono font-semibold">{inv.totalAmount ? Number(inv.totalAmount).toLocaleString() : "—"}</TableCell>
                  <TableCell>{inv.currency}</TableCell>
                  <TableCell>{inv.dueDate ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline">{inv.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
