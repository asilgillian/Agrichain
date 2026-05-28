import { useState } from "react";
import {
  useListLoanCategories,
  useCreateLoanCategory,
  useUpdateLoanCategory,
  useDeleteLoanCategory,
  useListLoanProducts,
  useCreateLoanProduct,
  useUpdateLoanProduct,
  useDeleteLoanProduct,
  useGetLoanProduct,
  useCreateLoanProductItem,
  useUpdateLoanProductItem,
  useDeleteLoanProductItem,
  getListLoanCategoriesQueryKey,
  getListLoanProductsQueryKey,
  getGetLoanProductQueryKey,
} from "@workspace/api-client-react";
import type {
  LoanCategory,
  LoanProduct,
  LoanProductInput,
  LoanProductItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Package2, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ============================================================================
// Loans → Catalog admin page (Phase 1).
// Tabs: Categories | Products. Category deletion is blocked by the API when
// products exist; the UI surfaces that as a toast. The Product detail dialog
// also manages in-kind items (Loan Product Items).
// ============================================================================
export default function LoansCatalogPage() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Layers className="h-6 w-6" /> Loans — Catalog
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Define loan categories and the products under each. Borrowing rules — interest, penalty,
          grace period, recovery method — are set on the product. Phase 2 will connect these to
          actual loan issuance.
        </p>
      </div>

      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories" data-testid="tab-categories">Categories</TabsTrigger>
          <TabsTrigger value="products" data-testid="tab-products">Products</TabsTrigger>
        </TabsList>
        <TabsContent value="categories" className="mt-4">
          <CategoriesPanel />
        </TabsContent>
        <TabsContent value="products" className="mt-4">
          <ProductsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================================
// Categories
// ============================================================================
function CategoriesPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: categories = [], isLoading } = useListLoanCategories();
  const [editing, setEditing] = useState<LoanCategory | null>(null);
  const [open, setOpen] = useState(false);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListLoanCategoriesQueryKey() });

  const createMut = useCreateLoanCategory({
    mutation: {
      onSuccess: () => { invalidate(); setOpen(false); toast({ title: "Category created" }); },
      onError: (e: any) => toast({ title: "Create failed", description: e?.message ?? "", variant: "destructive" }),
    },
  });
  const updateMut = useUpdateLoanCategory({
    mutation: {
      onSuccess: () => { invalidate(); setOpen(false); toast({ title: "Category updated" }); },
      onError: (e: any) => toast({ title: "Update failed", description: e?.message ?? "", variant: "destructive" }),
    },
  });
  const deleteMut = useDeleteLoanCategory({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Category deleted" }); },
      onError: (e: any) => toast({ title: "Delete failed", description: e?.message ?? "Refusing — products may exist.", variant: "destructive" }),
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Loan Categories</CardTitle>
        <Button onClick={() => { setEditing(null); setOpen(true); }} data-testid="btn-new-category">
          <Plus className="h-4 w-4 mr-1" /> New Category
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">No categories yet. Create one (e.g. "Input Loans", "Cash Advances").</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => (
                <TableRow key={c.id} data-testid={`category-row-${c.id}`}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.description ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={c.isActive ? "default" : "secondary"}>{c.isActive ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(c); setOpen(true); }} data-testid={`btn-edit-${c.id}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => {
                      if (confirm(`Delete "${c.name}"? This cannot be undone.`)) {
                        deleteMut.mutate({ id: c.id });
                      }
                    }} data-testid={`btn-delete-${c.id}`}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <CategoryDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        onSubmit={(data) => {
          if (editing) updateMut.mutate({ id: editing.id, data });
          else createMut.mutate({ data });
        }}
        submitting={createMut.isPending || updateMut.isPending}
      />
    </Card>
  );
}

type CategoryFormData = {
  name: string;
  description?: string | null;
  interestType?: "flat" | "reducing" | "none";
  interestRate?: number;
  penaltyRate?: number;
  gracePeriodDays?: number;
  isActive?: boolean;
};

function CategoryDialog({
  open, onOpenChange, editing, onSubmit, submitting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: LoanCategory | null;
  onSubmit: (data: CategoryFormData) => void;
  submitting: boolean;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [interestType, setInterestType] = useState<"flat" | "reducing" | "none">(editing?.interestType ?? "flat");
  const [interestRate, setInterestRate] = useState<string>(editing ? String(Number(editing.interestRate)) : "0");
  const [penaltyRate, setPenaltyRate] = useState<string>(editing ? String(Number(editing.penaltyRate)) : "0");
  const [gracePeriodDays, setGracePeriodDays] = useState<string>(editing ? String(editing.gracePeriodDays) : "0");
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (v) {
        setName(editing?.name ?? "");
        setDescription(editing?.description ?? "");
        setInterestType(editing?.interestType ?? "flat");
        setInterestRate(editing ? String(Number(editing.interestRate)) : "0");
        setPenaltyRate(editing ? String(Number(editing.penaltyRate)) : "0");
        setGracePeriodDays(editing ? String(editing.gracePeriodDays) : "0");
        setIsActive(editing?.isActive ?? true);
      }
      onOpenChange(v);
    }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Category" : "New Loan Category"}</DialogTitle>
          <DialogDescription>Groups related loan products. Rate defaults below apply to every product unless individually overridden.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-category-name" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description ?? ""} onChange={(e) => setDescription(e.target.value)} data-testid="input-category-description" />
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2 border-t">
            <div className="col-span-2 text-xs text-muted-foreground -mb-1">Rate defaults (products inherit unless overridden)</div>
            <div>
              <Label>Interest type</Label>
              <Select value={interestType} onValueChange={(v) => setInterestType(v as any)}>
                <SelectTrigger data-testid="select-category-interest-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">Flat</SelectItem>
                  <SelectItem value="reducing">Reducing balance</SelectItem>
                  <SelectItem value="none">No interest</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Interest rate (%)</Label>
              <Input type="number" step="0.01" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} data-testid="input-category-interest-rate" />
            </div>
            <div>
              <Label>Penalty rate (%)</Label>
              <Input type="number" step="0.01" value={penaltyRate} onChange={(e) => setPenaltyRate(e.target.value)} data-testid="input-category-penalty-rate" />
            </div>
            <div>
              <Label>Grace period (days)</Label>
              <Input type="number" value={gracePeriodDays} onChange={(e) => setGracePeriodDays(e.target.value)} data-testid="input-category-grace-days" />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} data-testid="switch-category-active" />
            <Label>Active</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!name.trim() || submitting}
            onClick={() => onSubmit({
              name: name.trim(),
              description: description || null,
              interestType,
              interestRate: Number(interestRate) || 0,
              penaltyRate: Number(penaltyRate) || 0,
              gracePeriodDays: Number(gracePeriodDays) || 0,
              isActive,
            })}
            data-testid="btn-save-category"
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Products
// ============================================================================
function ProductsPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: categories = [] } = useListLoanCategories();
  const [filterCategoryId, setFilterCategoryId] = useState<string>("");
  const { data: products = [], isLoading } = useListLoanProducts(
    filterCategoryId ? { loanCategoryId: filterCategoryId } : undefined,
  );
  const [editing, setEditing] = useState<LoanProduct | null>(null);
  const [open, setOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListLoanProductsQueryKey() });

  const createMut = useCreateLoanProduct({
    mutation: {
      onSuccess: () => { invalidate(); setOpen(false); toast({ title: "Product created" }); },
      onError: (e: any) => toast({ title: "Create failed", description: e?.message ?? "", variant: "destructive" }),
    },
  });
  const updateMut = useUpdateLoanProduct({
    mutation: {
      onSuccess: () => { invalidate(); setOpen(false); toast({ title: "Product updated" }); },
      onError: (e: any) => toast({ title: "Update failed", description: e?.message ?? "", variant: "destructive" }),
    },
  });
  const deleteMut = useDeleteLoanProduct({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Product deleted" }); },
      onError: (e: any) => toast({ title: "Delete failed", description: e?.message ?? "", variant: "destructive" }),
    },
  });

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
        <CardTitle>Loan Products</CardTitle>
        <div className="flex items-center gap-2">
          <Label className="text-xs whitespace-nowrap">Filter by category</Label>
          <Select value={filterCategoryId || "all"} onValueChange={(v) => setFilterCategoryId(v === "all" ? "" : v)}>
            <SelectTrigger className="w-56" data-testid="select-product-filter-category">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => { setEditing(null); setOpen(true); }}
            disabled={categories.length === 0}
            data-testid="btn-new-product"
          >
            <Plus className="h-4 w-4 mr-1" /> New Product
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">Create a category first.</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-muted-foreground">No products yet in this view.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Unit price</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Interest</TableHead>
                <TableHead>Penalty</TableHead>
                <TableHead>Grace</TableHead>
                <TableHead>Recovery</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => {
                const cat = categories.find((c) => c.id === p.loanCategoryId);
                // Show the effective value with a subtle "inherits" hint when
                // the product hasn't overridden the category default.
                const effInterestType = p.interestType ?? cat?.interestType ?? "flat";
                const effInterestRate = p.interestRate ?? cat?.interestRate ?? "0";
                const effPenaltyRate = p.penaltyRate ?? cat?.penaltyRate ?? "0";
                const effGrace = p.gracePeriodDays ?? cat?.gracePeriodDays ?? 0;
                const inheritsInterest = p.interestRate == null;
                const inheritsPenalty = p.penaltyRate == null;
                const inheritsGrace = p.gracePeriodDays == null;
                return (
                <TableRow key={p.id} data-testid={`product-row-${p.id}`}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{categoryName(p.loanCategoryId)}</TableCell>
                  <TableCell><Badge variant={p.productType === "INPUT" ? "default" : "outline"}>{p.productType}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{p.unitPrice ? `UGX ${Number(p.unitPrice).toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="text-xs">{p.unit ?? "—"}</TableCell>
                  <TableCell className={inheritsInterest ? "text-muted-foreground" : undefined}>
                    {Number(effInterestRate)}% <span className="text-xs">({effInterestType}){inheritsInterest ? " · inherited" : ""}</span>
                  </TableCell>
                  <TableCell className={inheritsPenalty ? "text-muted-foreground" : undefined}>{Number(effPenaltyRate)}%{inheritsPenalty ? " ·i" : ""}</TableCell>
                  <TableCell className={inheritsGrace ? "text-muted-foreground" : undefined}>{effGrace}d{inheritsGrace ? " ·i" : ""}</TableCell>
                  <TableCell className="text-xs">{p.repaymentMethod}</TableCell>
                  <TableCell>
                    <Badge variant={p.isActive ? "default" : "secondary"}>{p.isActive ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => setDetailId(p.id)} data-testid={`btn-items-${p.id}`} title="Manage in-kind items">
                      <Package2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(p); setOpen(true); }} data-testid={`btn-edit-product-${p.id}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => {
                      if (confirm(`Delete product "${p.name}"?`)) deleteMut.mutate({ id: p.id });
                    }} data-testid={`btn-delete-product-${p.id}`}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <ProductDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        categories={categories}
        defaultCategoryId={filterCategoryId}
        onSubmit={(data) => {
          if (editing) updateMut.mutate({ id: editing.id, data });
          else createMut.mutate({ data });
        }}
        submitting={createMut.isPending || updateMut.isPending}
      />

      {detailId && (
        <ProductItemsDialog
          productId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </Card>
  );
}

function ProductDialog({
  open, onOpenChange, editing, categories, defaultCategoryId, onSubmit, submitting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: LoanProduct | null;
  categories: LoanCategory[];
  defaultCategoryId: string;
  onSubmit: (data: LoanProductInput) => void;
  submitting: boolean;
}) {
  const initial = (): LoanProductInput => editing
    ? {
        loanCategoryId: editing.loanCategoryId,
        name: editing.name,
        commodityTypeId: editing.commodityTypeId ?? null,
        productType: editing.productType,
        unitPrice: editing.unitPrice != null ? Number(editing.unitPrice) : null,
        unit: editing.unit ?? null,
        // null = inherit from category. Keep nulls as nulls so the UI shows
        // the placeholder hint instead of mistakenly stamping a 0 override.
        interestType: editing.interestType ?? null,
        interestRate: editing.interestRate != null ? Number(editing.interestRate) : null,
        penaltyRate: editing.penaltyRate != null ? Number(editing.penaltyRate) : null,
        gracePeriodDays: editing.gracePeriodDays ?? null,
        maxAmount: editing.maxAmount != null ? Number(editing.maxAmount) : null,
        maxRestructures: editing.maxRestructures,
        repaymentMethod: editing.repaymentMethod,
        recoveryPriority: editing.recoveryPriority,
        allowPartialRepayment: editing.allowPartialRepayment,
        allowFinanceOverride: editing.allowFinanceOverride,
        seasonBased: editing.seasonBased,
        isActive: editing.isActive,
      }
    : {
        loanCategoryId: defaultCategoryId || categories[0]?.id || "",
        name: "",
        commodityTypeId: null,
        productType: "CASH",
        unitPrice: null,
        unit: null,
        interestType: null,
        interestRate: null,
        penaltyRate: null,
        gracePeriodDays: null,
        maxAmount: null,
        maxRestructures: 0,
        repaymentMethod: "auto_deduct",
        recoveryPriority: 100,
        allowPartialRepayment: true,
        allowFinanceOverride: true,
        seasonBased: false,
        isActive: true,
      };

  const [form, setForm] = useState<LoanProductInput>(initial());
  // Look up the category currently bound to the form so the rate inputs can
  // show the inherited default as placeholder text.
  const boundCategory = categories.find((c) => c.id === form.loanCategoryId);

  const reset = () => setForm(initial());
  const set = <K extends keyof LoanProductInput>(k: K, v: LoanProductInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (v) reset();
      onOpenChange(v);
    }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Loan Product" : "New Loan Product"}</DialogTitle>
          <DialogDescription>Interest, penalty, and recovery rules apply when a loan of this product is issued in Phase 2.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} data-testid="input-product-name" />
          </div>

          <div>
            <Label>Category</Label>
            <Select value={form.loanCategoryId} onValueChange={(v) => set("loanCategoryId", v)}>
              <SelectTrigger data-testid="select-product-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Product type</Label>
            <Select value={form.productType ?? "CASH"} onValueChange={(v) => set("productType", v as LoanProductInput["productType"])}>
              <SelectTrigger data-testid="select-product-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="INPUT">Input (in-kind, fixed price)</SelectItem>
                <SelectItem value="CASH">Cash (operator-entered)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.productType === "INPUT" && (
            <>
              <div>
                <Label>Unit price (UGX)</Label>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={form.unitPrice ?? ""}
                  onChange={(e) => set("unitPrice", e.target.value ? Number(e.target.value) : null)}
                  placeholder="e.g. 50000"
                  data-testid="input-unit-price"
                />
              </div>
              <div>
                <Label>Unit</Label>
                <Input
                  value={form.unit ?? ""}
                  onChange={(e) => set("unit", e.target.value || null)}
                  placeholder="e.g. 50kg bag, litre"
                  data-testid="input-unit"
                  maxLength={40}
                />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground -mt-1">
                Operators pick a quantity at issuance; principal = unit price × quantity.
              </p>
            </>
          )}

          <div className="col-span-2 text-xs text-muted-foreground pt-2 border-t -mb-1">
            Rate overrides — leave blank to inherit from <span className="font-medium">{boundCategory?.name ?? "category"}</span>.
          </div>

          <div>
            <Label>Interest type</Label>
            <Select
              value={form.interestType ?? "__inherit"}
              onValueChange={(v) => set("interestType", v === "__inherit" ? null : (v as LoanProductInput["interestType"]))}
            >
              <SelectTrigger data-testid="select-interest-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__inherit">Inherit ({boundCategory?.interestType ?? "flat"})</SelectItem>
                <SelectItem value="flat">Flat</SelectItem>
                <SelectItem value="reducing">Reducing balance</SelectItem>
                <SelectItem value="none">No interest</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Interest rate (%)</Label>
            <Input
              type="number" step="0.01"
              value={form.interestRate ?? ""}
              onChange={(e) => set("interestRate", e.target.value === "" ? null : Number(e.target.value))}
              placeholder={boundCategory ? `inherits ${Number(boundCategory.interestRate)}` : "0"}
              data-testid="input-interest-rate"
            />
          </div>
          <div>
            <Label>Penalty rate (%)</Label>
            <Input
              type="number" step="0.01"
              value={form.penaltyRate ?? ""}
              onChange={(e) => set("penaltyRate", e.target.value === "" ? null : Number(e.target.value))}
              placeholder={boundCategory ? `inherits ${Number(boundCategory.penaltyRate)}` : "0"}
              data-testid="input-penalty-rate"
            />
          </div>

          <div>
            <Label>Grace period (days)</Label>
            <Input
              type="number"
              value={form.gracePeriodDays ?? ""}
              onChange={(e) => set("gracePeriodDays", e.target.value === "" ? null : Number(e.target.value))}
              placeholder={boundCategory ? `inherits ${boundCategory.gracePeriodDays}` : "0"}
              data-testid="input-grace-days"
            />
          </div>
          <div>
            <Label>Max amount (UGX, optional)</Label>
            <Input type="number" value={form.maxAmount ?? ""} onChange={(e) => set("maxAmount", e.target.value ? Number(e.target.value) : null)} data-testid="input-max-amount" />
          </div>

          <div>
            <Label>Max restructures</Label>
            <Input type="number" value={form.maxRestructures ?? 0} onChange={(e) => set("maxRestructures", Number(e.target.value))} data-testid="input-max-restructures" />
          </div>
          <div>
            <Label>Recovery priority (lower runs first)</Label>
            <Input type="number" value={form.recoveryPriority ?? 100} onChange={(e) => set("recoveryPriority", Number(e.target.value))} data-testid="input-recovery-priority" />
          </div>

          <div className="col-span-2">
            <Label>Repayment method</Label>
            <Select value={form.repaymentMethod ?? "auto_deduct"} onValueChange={(v) => set("repaymentMethod", v as LoanProductInput["repaymentMethod"])}>
              <SelectTrigger data-testid="select-repayment-method"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto_deduct">Auto-deduct from deliveries</SelectItem>
                <SelectItem value="manual">Manual cash repayment</SelectItem>
                <SelectItem value="hybrid">Hybrid (both)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <ToggleRow label="Allow partial repayment" value={form.allowPartialRepayment ?? true} onChange={(v) => set("allowPartialRepayment", v)} testId="switch-partial" />
          <ToggleRow label="Allow finance override" value={form.allowFinanceOverride ?? true} onChange={(v) => set("allowFinanceOverride", v)} testId="switch-override" />
          <ToggleRow label="Season-based" value={form.seasonBased ?? false} onChange={(v) => set("seasonBased", v)} testId="switch-season" />
          <ToggleRow label="Active" value={form.isActive ?? true} onChange={(v) => set("isActive", v)} testId="switch-product-active" />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            // INPUT products need a positive unit price + unit label before they're usable.
            disabled={
              !form.name.trim() ||
              !form.loanCategoryId ||
              (form.productType === "INPUT" && (!form.unitPrice || form.unitPrice <= 0 || !form.unit?.trim())) ||
              submitting
            }
            onClick={() => onSubmit(form)}
            data-testid="btn-save-product"
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({ label, value, onChange, testId }: { label: string; value: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <div className="flex items-center justify-between border rounded-md px-3 py-2">
      <Label className="text-sm">{label}</Label>
      <Switch checked={value} onCheckedChange={onChange} data-testid={testId} />
    </div>
  );
}

// ============================================================================
// Product Items (in-kind line items)
// ============================================================================
function ProductItemsDialog({ productId, onClose }: { productId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useGetLoanProduct(productId);
  const invalidate = () => qc.invalidateQueries({ queryKey: getGetLoanProductQueryKey(productId) });

  const createMut = useCreateLoanProductItem({
    mutation: { onSuccess: () => { invalidate(); toast({ title: "Item added" }); } },
  });
  const updateMut = useUpdateLoanProductItem({
    mutation: { onSuccess: () => { invalidate(); toast({ title: "Item updated" }); } },
  });
  const deleteMut = useDeleteLoanProductItem({
    mutation: { onSuccess: () => { invalidate(); toast({ title: "Item removed" }); } },
  });

  const [itemName, setItemName] = useState("");
  const [unitPrice, setUnitPrice] = useState<number>(0);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>In-kind items{data ? ` — ${data.name}` : ""}</DialogTitle>
          <DialogDescription>For input loans, list each physical item (e.g. NPK 50kg bag) and its current unit cost in UGX.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Unit price (UGX)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.items ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-muted-foreground text-sm">No items.</TableCell></TableRow>
                ) : data!.items.map((it: LoanProductItem) => (
                  <TableRow key={it.id} data-testid={`item-row-${it.id}`}>
                    <TableCell>{it.itemName}</TableCell>
                    <TableCell>{Number(it.unitPrice).toLocaleString()}</TableCell>
                    <TableCell>
                      <Switch
                        checked={it.isActive}
                        onCheckedChange={(v) => updateMut.mutate({ itemId: it.id, data: { itemName: it.itemName, unitPrice: Number(it.unitPrice), isActive: v } })}
                        data-testid={`switch-item-${it.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => {
                        if (confirm(`Remove "${it.itemName}"?`)) deleteMut.mutate({ itemId: it.id });
                      }} data-testid={`btn-delete-item-${it.id}`}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="border-t pt-3 mt-3 grid grid-cols-[1fr_180px_auto] gap-2 items-end">
              <div>
                <Label>New item name</Label>
                <Input value={itemName} onChange={(e) => setItemName(e.target.value)} data-testid="input-new-item-name" />
              </div>
              <div>
                <Label>Unit price</Label>
                <Input type="number" value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} data-testid="input-new-item-price" />
              </div>
              <Button
                disabled={!itemName.trim() || createMut.isPending}
                onClick={() => createMut.mutate({ id: productId, data: { itemName: itemName.trim(), unitPrice } }, {
                  onSuccess: () => { setItemName(""); setUnitPrice(0); },
                })}
                data-testid="btn-add-item"
              >
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
