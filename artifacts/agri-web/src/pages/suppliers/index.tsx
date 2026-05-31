import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSuppliers,
  useCreateSupplier,
  useUpdateSupplier,
  getListSuppliersQueryKey,
  type Supplier,
  type SupplierInput,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Building2, User } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { DEFAULT_PHONE_CODE } from "@/lib/currency";

type SellerType = "business" | "individual";

const emptyForm = {
  sellerType: "business" as SellerType,
  businessName: "",
  businessRegNo: "",
  firstName: "",
  lastName: "",
  nationalId: "",
  phoneNumber: DEFAULT_PHONE_CODE,
  email: "",
  village: "",
  address: "",
  paymentMethod: "cash" as "cash" | "mobile_money" | "bank_transfer",
  momoProvider: "mtn_momo" as "mtn_momo" | "airtel_money",
  momoMsisdn: "",
  bankName: "",
  bankAccountNumber: "",
  notes: "",
};

type FormState = typeof emptyForm;

function supplierName(s: Supplier): string {
  return s.sellerType === "business"
    ? (s.businessName ?? "—")
    : [s.firstName, s.lastName].filter(Boolean).join(" ") || "—";
}

export default function SuppliersList() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | SellerType>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { has, isLoading: permsLoading } = usePermissions();
  const canWrite = has("suppliers.write");

  const params = {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(typeFilter !== "all" ? { sellerType: typeFilter } : {}),
  };
  const { data: suppliers, isLoading } = useListSuppliers(params);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() });

  const createMut = useCreateSupplier({
    mutation: {
      onSuccess: (s) => {
        invalidate();
        toast({ title: "Supplier registered", description: s.referenceNumber });
        closeDialog();
      },
      onError: (e: any) => toast({ title: "Could not register supplier", description: e?.message, variant: "destructive" }),
    },
  });

  const updateMut = useUpdateSupplier({
    mutation: {
      onSuccess: (s) => {
        invalidate();
        toast({ title: "Supplier updated", description: s.referenceNumber });
        closeDialog();
      },
      onError: (e: any) => toast({ title: "Could not update supplier", description: e?.message, variant: "destructive" }),
    },
  });

  const submitting = createMut.isPending || updateMut.isPending;

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(s: Supplier) {
    setEditing(s);
    setForm({
      sellerType: s.sellerType,
      businessName: s.businessName ?? "",
      businessRegNo: s.businessRegNo ?? "",
      firstName: s.firstName ?? "",
      lastName: s.lastName ?? "",
      nationalId: s.nationalId ?? "",
      phoneNumber: s.phoneNumber ?? DEFAULT_PHONE_CODE,
      email: s.email ?? "",
      village: s.village ?? "",
      address: s.address ?? "",
      paymentMethod: (s.paymentMethod ?? "cash") as FormState["paymentMethod"],
      momoProvider: (s.momoProvider ?? "mtn") as FormState["momoProvider"],
      momoMsisdn: s.momoMsisdn ?? "",
      bankName: s.bankName ?? "",
      bankAccountNumber: s.bankAccountNumber ?? "",
      notes: s.notes ?? "",
    });
    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
    setEditing(null);
    setForm(emptyForm);
  }

  function buildPayload(): SupplierInput {
    const phone = form.phoneNumber.trim();
    const payload: SupplierInput = {
      sellerType: form.sellerType,
      phoneNumber: phone && phone !== DEFAULT_PHONE_CODE ? phone : null,
      email: form.email.trim() || null,
      village: form.village.trim() || null,
      address: form.address.trim() || null,
      paymentMethod: form.paymentMethod,
      notes: form.notes.trim() || null,
    };
    if (form.sellerType === "business") {
      payload.businessName = form.businessName.trim();
      payload.businessRegNo = form.businessRegNo.trim() || null;
    } else {
      payload.firstName = form.firstName.trim();
      payload.lastName = form.lastName.trim() || null;
      payload.nationalId = form.nationalId.trim();
    }
    if (form.paymentMethod === "mobile_money") {
      payload.momoProvider = form.momoProvider;
      payload.momoMsisdn = form.momoMsisdn.trim() || null;
    } else if (form.paymentMethod === "bank_transfer") {
      payload.bankName = form.bankName.trim() || null;
      payload.bankAccountNumber = form.bankAccountNumber.trim() || null;
    }
    return payload;
  }

  function submit() {
    if (form.sellerType === "business") {
      if (!form.businessName.trim()) {
        toast({ title: "Business name is required", variant: "destructive" });
        return;
      }
    } else {
      if (!form.firstName.trim() || !form.nationalId.trim()) {
        toast({ title: "First name and national ID are required", variant: "destructive" });
        return;
      }
    }
    const payload = buildPayload();
    if (editing) {
      updateMut.mutate({ supplierId: editing.id, data: payload });
    } else {
      createMut.mutate({ data: payload });
    }
  }

  const rows = suppliers ?? [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Third-Party Sellers</h1>
          <p className="text-muted-foreground mt-1">Suppliers who sell produce through the same delivery and payment pipeline as farmers.</p>
        </div>
        {(canWrite || permsLoading) && (
          <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : closeDialog())}>
            <DialogTrigger asChild>
              <Button className="gap-2" disabled={!canWrite} onClick={openCreate} data-testid="add-supplier-btn">
                <Plus className="h-4 w-4" /> Register Supplier
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editing ? "Edit Supplier" : "Register Third-Party Seller"}</DialogTitle>
                <DialogDescription>Capture the seller's identity, contact, and payout details.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Seller type *</Label>
                  <Select value={form.sellerType} onValueChange={(v: SellerType) => setForm({ ...form, sellerType: v })}>
                    <SelectTrigger data-testid="supplier-seller-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="business">Business</SelectItem>
                      <SelectItem value="individual">Individual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.sellerType === "business" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Business name *</Label><Input value={form.businessName} onChange={e => setForm({ ...form, businessName: e.target.value })} data-testid="supplier-business-name" /></div>
                    <div><Label>Reg. number</Label><Input value={form.businessRegNo} onChange={e => setForm({ ...form, businessRegNo: e.target.value })} data-testid="supplier-business-reg" /></div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>First name *</Label><Input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} data-testid="supplier-first-name" /></div>
                      <div><Label>Last name</Label><Input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} data-testid="supplier-last-name" /></div>
                    </div>
                    <div><Label>National ID *</Label><Input value={form.nationalId} onChange={e => setForm({ ...form, nationalId: e.target.value })} data-testid="supplier-national-id" /></div>
                  </>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Phone</Label><Input value={form.phoneNumber} onChange={e => setForm({ ...form, phoneNumber: e.target.value })} placeholder="+256..." data-testid="supplier-phone" /></div>
                  <div><Label>Email</Label><Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} data-testid="supplier-email" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Village</Label><Input value={form.village} onChange={e => setForm({ ...form, village: e.target.value })} data-testid="supplier-village" /></div>
                  <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} data-testid="supplier-address" /></div>
                </div>

                <div>
                  <Label>Payout method</Label>
                  <Select value={form.paymentMethod} onValueChange={(v: FormState["paymentMethod"]) => setForm({ ...form, paymentMethod: v })}>
                    <SelectTrigger data-testid="supplier-payment-method"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="mobile_money">Mobile Money</SelectItem>
                      <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.paymentMethod === "mobile_money" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Provider</Label>
                      <Select value={form.momoProvider} onValueChange={(v: FormState["momoProvider"]) => setForm({ ...form, momoProvider: v })}>
                        <SelectTrigger data-testid="supplier-momo-provider"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mtn_momo">MTN MoMo</SelectItem>
                          <SelectItem value="airtel_money">Airtel Money</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>MoMo number</Label><Input value={form.momoMsisdn} onChange={e => setForm({ ...form, momoMsisdn: e.target.value })} placeholder="+256..." data-testid="supplier-momo-msisdn" /></div>
                  </div>
                )}
                {form.paymentMethod === "bank_transfer" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Bank name</Label><Input value={form.bankName} onChange={e => setForm({ ...form, bankName: e.target.value })} data-testid="supplier-bank-name" /></div>
                    <div><Label>Account number</Label><Input value={form.bankAccountNumber} onChange={e => setForm({ ...form, bankAccountNumber: e.target.value })} data-testid="supplier-bank-account" /></div>
                  </div>
                )}

                <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} data-testid="supplier-notes" /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeDialog}>Cancel</Button>
                <Button onClick={submit} disabled={submitting} data-testid="submit-supplier">{submitting ? "Saving…" : editing ? "Save" : "Register"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <div className="p-4 border-b flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between bg-muted/20">
          <div className="relative w-full sm:max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by name, ref, or phone..."
              className="pl-8 bg-background"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="search-suppliers"
            />
          </div>
          <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
            <SelectTrigger className="w-full sm:w-[200px] bg-background" data-testid="supplier-type-filter">
              <SelectValue placeholder="All seller types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All seller types</SelectItem>
              <SelectItem value="business">Business</SelectItem>
              <SelectItem value="individual">Individual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Seller</TableHead>
                <TableHead>Ref Number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Payout</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-6 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No suppliers found.</TableCell>
                </TableRow>
              ) : (
                rows.map((s) => (
                  <TableRow key={s.id} className="hover:bg-muted/50" data-testid={`supplier-row-${s.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {s.sellerType === "business" ? <Building2 className="h-4 w-4 text-muted-foreground" /> : <User className="h-4 w-4 text-muted-foreground" />}
                        <span className="font-medium">{supplierName(s)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.referenceNumber}</TableCell>
                    <TableCell><Badge variant="outline">{s.sellerType === "business" ? "Business" : "Individual"}</Badge></TableCell>
                    <TableCell>{s.phoneNumber || "-"}</TableCell>
                    <TableCell className="capitalize">{s.paymentMethod ?? "-"}</TableCell>
                    <TableCell>
                      <Badge variant={s.status === "active" ? "default" : s.status === "inactive" ? "destructive" : "secondary"}>{s.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {canWrite && (
                        <Button variant="ghost" size="sm" onClick={() => openEdit(s)} data-testid={`edit-supplier-${s.id}`}>Edit</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
