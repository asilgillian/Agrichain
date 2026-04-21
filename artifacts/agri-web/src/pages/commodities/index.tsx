import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Leaf, Plus, Tag, Coins, ArrowRightLeft, CalendarRange, FlaskConical } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

type Commodity = {
  id: string; name: string; code: string; scientificName: string | null;
  defaultUnit: string; description: string | null; status: string;
  types: CommodityType[];
};
type CommodityType = {
  id: string; commodityId: string; name: string; code: string;
  stage: "raw" | "intermediate" | "finished";
  parentCommodityTypeId: string | null;
  isPurchasable: boolean;
  isSellable: boolean;
  defaultUnit: string;
  defaultMoistureMin: string | null;
  defaultMoistureMax: string | null;
  status: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return customFetch<T>(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

const stageBadge: Record<string, "default" | "secondary" | "outline"> = {
  raw: "outline", intermediate: "secondary", finished: "default",
};

export default function CommoditiesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);

  const { data: commodities, isLoading } = useQuery<Commodity[]>({
    queryKey: ["/api/commodities"],
    queryFn: () => api<Commodity[]>("/api/commodities"),
  });

  const allTypes = useMemo(
    () => commodities?.flatMap(c => c.types.map(t => ({ ...t, commodityName: c.name }))) ?? [],
    [commodities],
  );
  const typesByCommodity = useMemo(() => {
    const m = new Map<string, CommodityType[]>();
    (commodities ?? []).forEach(c => m.set(c.id, c.types));
    return m;
  }, [commodities]);
  const selectedType = useMemo(() => allTypes.find(t => t.id === selectedTypeId), [allTypes, selectedTypeId]);
  const selectedCommodity = useMemo(
    () => commodities?.find(c => c.id === selectedType?.commodityId),
    [commodities, selectedType],
  );

  // ---- Create commodity ----
  const [cOpen, setCOpen] = useState(false);
  const [cForm, setCForm] = useState({ name: "", code: "", scientificName: "", defaultUnit: "kg", description: "" });
  const createCommodity = useMutation({
    mutationFn: (b: any) => api("/api/commodities", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commodities"] });
      setCOpen(false);
      setCForm({ name: "", code: "", scientificName: "", defaultUnit: "kg", description: "" });
      toast({ title: "Commodity created" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // ---- Create type ----
  const [tOpen, setTOpen] = useState(false);
  const initialTForm = {
    commodityId: "", name: "", code: "", stage: "raw" as const,
    parentCommodityTypeId: "__none__", isPurchasable: true, isSellable: true, defaultUnit: "kg",
    defaultMoistureMin: "", defaultMoistureMax: "",
  };
  const [tForm, setTForm] = useState(initialTForm);
  const createType = useMutation({
    mutationFn: ({ commodityId, ...body }: any) => api(`/api/commodities/${commodityId}/types`, {
      method: "POST",
      body: JSON.stringify({
        ...body,
        parentCommodityTypeId: body.parentCommodityTypeId === "__none__" ? null : body.parentCommodityTypeId,
        defaultMoistureMin: body.defaultMoistureMin || null,
        defaultMoistureMax: body.defaultMoistureMax || null,
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commodities"] });
      setTOpen(false);
      setTForm(initialTForm);
      toast({ title: "Variety added" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><Leaf className="h-7 w-7 text-green-600" /> Commodities</h1>
          <p className="text-muted-foreground">Master catalog, variants & processing stages, daily prices, conversions, and seasons.</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={cOpen} onOpenChange={setCOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="btn-new-commodity"><Plus className="h-4 w-4 mr-1" /> New Commodity</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Commodity</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Name</Label><Input value={cForm.name} onChange={e => setCForm({ ...cForm, name: e.target.value })} placeholder="Coffee" data-testid="input-commodity-name" /></div>
                  <div><Label>Code</Label><Input value={cForm.code} onChange={e => setCForm({ ...cForm, code: e.target.value })} placeholder="coffee" data-testid="input-commodity-code" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Scientific Name</Label><Input value={cForm.scientificName} onChange={e => setCForm({ ...cForm, scientificName: e.target.value })} placeholder="Coffea spp." /></div>
                  <div><Label>Default Unit</Label><Input value={cForm.defaultUnit} onChange={e => setCForm({ ...cForm, defaultUnit: e.target.value })} placeholder="kg" /></div>
                </div>
                <div><Label>Description</Label><Input value={cForm.description} onChange={e => setCForm({ ...cForm, description: e.target.value })} placeholder="Optional" /></div>
              </div>
              <DialogFooter>
                <Button onClick={() => createCommodity.mutate({
                  ...cForm,
                  scientificName: cForm.scientificName || undefined,
                  description: cForm.description || undefined,
                })} disabled={!cForm.name || !cForm.code} data-testid="btn-save-commodity">Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={tOpen} onOpenChange={setTOpen}>
            <DialogTrigger asChild>
              <Button data-testid="btn-new-type"><Plus className="h-4 w-4 mr-1" /> New Variety / Stage</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>New Variety / Processing Stage</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Commodity</Label>
                  <Select value={tForm.commodityId} onValueChange={(v) => setTForm({ ...tForm, commodityId: v, parentCommodityTypeId: "__none__" })}>
                    <SelectTrigger data-testid="select-type-commodity"><SelectValue placeholder="Pick a commodity" /></SelectTrigger>
                    <SelectContent>{commodities?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Name</Label><Input value={tForm.name} onChange={e => setTForm({ ...tForm, name: e.target.value })} placeholder="Robusta Cherry" data-testid="input-type-name" /></div>
                  <div><Label>Code</Label><Input value={tForm.code} onChange={e => setTForm({ ...tForm, code: e.target.value })} placeholder="robusta_cherry" data-testid="input-type-code" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Stage</Label>
                    <Select value={tForm.stage} onValueChange={(v: any) => setTForm({ ...tForm, stage: v })}>
                      <SelectTrigger data-testid="select-stage"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="raw">Raw</SelectItem>
                        <SelectItem value="intermediate">Intermediate</SelectItem>
                        <SelectItem value="finished">Finished</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Parent (transforms from)</Label>
                    <Select value={tForm.parentCommodityTypeId} onValueChange={(v) => setTForm({ ...tForm, parentCommodityTypeId: v })} disabled={!tForm.commodityId}>
                      <SelectTrigger><SelectValue placeholder="None (top-level)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— None —</SelectItem>
                        {(typesByCommodity.get(tForm.commodityId) ?? []).map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name} <span className="text-muted-foreground">({p.stage})</span></SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label>Default Unit</Label><Input value={tForm.defaultUnit} onChange={e => setTForm({ ...tForm, defaultUnit: e.target.value })} /></div>
                  <div><Label>Moisture Min %</Label><Input type="number" step="0.1" value={tForm.defaultMoistureMin} onChange={e => setTForm({ ...tForm, defaultMoistureMin: e.target.value })} /></div>
                  <div><Label>Moisture Max %</Label><Input type="number" step="0.1" value={tForm.defaultMoistureMax} onChange={e => setTForm({ ...tForm, defaultMoistureMax: e.target.value })} /></div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input id="isPurchasable" type="checkbox" checked={tForm.isPurchasable} onChange={e => setTForm({ ...tForm, isPurchasable: e.target.checked })} />
                    <Label htmlFor="isPurchasable" className="cursor-pointer">Purchasable (can be bought from farmers)</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input id="isSellable" type="checkbox" checked={tForm.isSellable} onChange={e => setTForm({ ...tForm, isSellable: e.target.checked })} />
                    <Label htmlFor="isSellable" className="cursor-pointer">Sellable (can be sold to buyers)</Label>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => createType.mutate(tForm)} disabled={!tForm.commodityId || !tForm.name || !tForm.code} data-testid="btn-save-type">Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? <Skeleton className="h-64" /> : (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Tag className="h-5 w-5" /> Catalog</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Commodity</TableHead>
                  <TableHead>Variety / Stage</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Buy / Sell</TableHead>
                  <TableHead>Moisture</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {allTypes.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No varieties yet — start by creating a commodity, then add a variety.</TableCell></TableRow>
                )}
                {allTypes.map(t => (
                  <TableRow key={t.id} data-testid={`row-type-${t.code}`}>
                    <TableCell className="font-medium">{t.commodityName}</TableCell>
                    <TableCell>{t.name} <span className="text-muted-foreground text-xs">{t.code}</span></TableCell>
                    <TableCell><Badge variant={stageBadge[t.stage] ?? "outline"}>{t.stage}</Badge></TableCell>
                    <TableCell>{t.isTradable ? "Yes" : "No"}</TableCell>
                    <TableCell>{t.defaultMoistureMin || t.defaultMoistureMax ? `${t.defaultMoistureMin ?? "—"}–${t.defaultMoistureMax ?? "—"}%` : "—"}</TableCell>
                    <TableCell><Badge variant={t.status === "active" ? "default" : "secondary"}>{t.status}</Badge></TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => setSelectedTypeId(t.id)} data-testid={`btn-manage-${t.code}`}>Manage</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedType} onOpenChange={(o) => !o && setSelectedTypeId(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {selectedType?.name} <span className="text-muted-foreground text-base font-normal">{selectedType?.code}</span>
              {selectedType && <Badge variant={stageBadge[selectedType.stage]} className="ml-2">{selectedType.stage}</Badge>}
            </DialogTitle>
          </DialogHeader>
          {selectedType && selectedCommodity && (
            <ManagePanel type={selectedType} commodity={selectedCommodity} siblings={typesByCommodity.get(selectedType.commodityId) ?? []} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ManagePanel({ type, commodity, siblings }: { type: CommodityType; commodity: Commodity; siblings: CommodityType[] }) {
  return (
    <Tabs defaultValue="prices" className="w-full">
      <TabsList>
        <TabsTrigger value="prices"><Coins className="h-4 w-4 mr-1" /> Prices</TabsTrigger>
        <TabsTrigger value="conversions"><ArrowRightLeft className="h-4 w-4 mr-1" /> Conversions</TabsTrigger>
        <TabsTrigger value="seasons"><CalendarRange className="h-4 w-4 mr-1" /> Seasons</TabsTrigger>
        <TabsTrigger value="quality"><FlaskConical className="h-4 w-4 mr-1" /> Quality Specs</TabsTrigger>
      </TabsList>
      <TabsContent value="prices"><PricesPanel type={type} commodity={commodity} /></TabsContent>
      <TabsContent value="conversions"><ConversionsPanel type={type} siblings={siblings} /></TabsContent>
      <TabsContent value="seasons"><SeasonsPanel type={type} /></TabsContent>
      <TabsContent value="quality"><QualitySpecsPanel type={type} /></TabsContent>
    </Tabs>
  );
}

function PricesPanel({ type, commodity }: { type: CommodityType; commodity: Commodity }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: prices } = useQuery<any[]>({
    queryKey: [`/api/commodity-types/${type.id}/prices`],
    queryFn: () => api(`/api/commodity-types/${type.id}/prices`),
  });
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ pricePerKg: "", currency: "UGX", effectiveDate: today, source: "manual", notes: "" });
  const create = useMutation({
    mutationFn: (b: any) => api(`/api/commodity-types/${type.id}/prices`, { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/commodity-types/${type.id}/prices`] });
      toast({ title: "Price set" });
      setForm(f => ({ ...f, pricePerKg: "", notes: "" }));
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="space-y-4 mt-3">
      <div className="text-sm text-muted-foreground">Price per kg of <strong>{type.name}</strong> ({commodity.name}). Latest effective date wins; older rows kept for audit.</div>
      <div className="grid grid-cols-6 gap-2 items-end">
        <div className="col-span-1"><Label>Price / kg</Label><Input type="number" step="1" value={form.pricePerKg} onChange={e => setForm({ ...form, pricePerKg: e.target.value })} data-testid="input-price" /></div>
        <div><Label>Currency</Label><Input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></div>
        <div><Label>Effective</Label><Input type="date" value={form.effectiveDate} onChange={e => setForm({ ...form, effectiveDate: e.target.value })} /></div>
        <div><Label>Source</Label>
          <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="market">Market</SelectItem>
              <SelectItem value="contract">Contract</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-1"><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
        <Button onClick={() => create.mutate({ ...form, pricePerKg: Number(form.pricePerKg), notes: form.notes || undefined })} disabled={!form.pricePerKg || !form.effectiveDate} data-testid="btn-set-price">Set Price</Button>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Effective</TableHead><TableHead>Price/kg</TableHead><TableHead>Source</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader>
        <TableBody>
          {(prices ?? []).map(p => (
            <TableRow key={p.id}><TableCell>{p.effectiveDate}</TableCell><TableCell>{p.currency} {Number(p.pricePerKg).toLocaleString()}</TableCell><TableCell>{p.source}</TableCell><TableCell>{p.notes ?? "—"}</TableCell></TableRow>
          ))}
          {(prices ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground text-center py-6">No prices yet.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}

function ConversionsPanel({ type, siblings }: { type: CommodityType; siblings: CommodityType[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: conversions } = useQuery<any[]>({
    queryKey: [`/api/commodity-types/${type.id}/conversions`],
    queryFn: () => api(`/api/commodity-types/${type.id}/conversions`),
  });
  const today = new Date().toISOString().slice(0, 10);
  const otherTypes = siblings.filter(s => s.id !== type.id);
  const [form, setForm] = useState({
    direction: "from" as "from" | "to", // current type is the "from" or the "to"
    otherTypeId: "",
    expectedRate: "", minRate: "", maxRate: "",
    processType: "", effectiveDate: today, notes: "",
  });
  const typeName = (id: string) => siblings.find(s => s.id === id)?.name ?? id.slice(0, 8);
  const create = useMutation({
    mutationFn: (b: any) => api("/api/commodity-conversions", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/commodity-types/${type.id}/conversions`] });
      toast({ title: "Conversion added" });
      setForm(f => ({ ...f, expectedRate: "", minRate: "", maxRate: "", processType: "", notes: "" }));
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/commodity-conversions/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`/api/commodity-types/${type.id}/conversions`] }),
  });

  const submit = () => {
    const fromCommodityTypeId = form.direction === "from" ? type.id : form.otherTypeId;
    const toCommodityTypeId = form.direction === "from" ? form.otherTypeId : type.id;
    create.mutate({
      fromCommodityTypeId, toCommodityTypeId,
      expectedRate: Number(form.expectedRate),
      minRate: form.minRate ? Number(form.minRate) : undefined,
      maxRate: form.maxRate ? Number(form.maxRate) : undefined,
      processType: form.processType || undefined,
      effectiveDate: form.effectiveDate,
      notes: form.notes || undefined,
    });
  };

  return (
    <div className="space-y-4 mt-3">
      <div className="text-sm text-muted-foreground">
        Conversion ratio = output kg per 1 kg input. e.g. Cherry → Parchment = 0.45 means 1 kg cherry yields 0.45 kg parchment.
      </div>
      {otherTypes.length === 0 ? (
        <div className="text-sm text-muted-foreground border rounded-md p-3">Add another variety/stage under <strong>{typeName(type.commodityId)}</strong> to define conversions.</div>
      ) : (
        <div className="grid grid-cols-7 gap-2 items-end">
          <div>
            <Label>Direction</Label>
            <Select value={form.direction} onValueChange={(v: any) => setForm({ ...form, direction: v })}>
              <SelectTrigger data-testid="select-direction"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="from">{type.name} → ...</SelectItem>
                <SelectItem value="to">... → {type.name}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>{form.direction === "from" ? "To Type" : "From Type"}</Label>
            <Select value={form.otherTypeId} onValueChange={(v) => setForm({ ...form, otherTypeId: v })}>
              <SelectTrigger data-testid="select-other-type"><SelectValue placeholder="Pick a stage" /></SelectTrigger>
              <SelectContent>
                {otherTypes.map(s => <SelectItem key={s.id} value={s.id}>{s.name} ({s.stage})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Expected</Label><Input type="number" step="0.0001" value={form.expectedRate} onChange={e => setForm({ ...form, expectedRate: e.target.value })} placeholder="0.45" data-testid="input-expected-rate" /></div>
          <div><Label>Min</Label><Input type="number" step="0.0001" value={form.minRate} onChange={e => setForm({ ...form, minRate: e.target.value })} placeholder="0.40" /></div>
          <div><Label>Max</Label><Input type="number" step="0.0001" value={form.maxRate} onChange={e => setForm({ ...form, maxRate: e.target.value })} placeholder="0.50" /></div>
          <Button onClick={submit} disabled={!form.otherTypeId || !form.expectedRate} data-testid="btn-add-conversion">Add</Button>
        </div>
      )}
      {otherTypes.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div><Label>Process Type</Label><Input value={form.processType} onChange={e => setForm({ ...form, processType: e.target.value })} placeholder="Pulping / Drying / Hulling" /></div>
          <div><Label>Effective Date</Label><Input type="date" value={form.effectiveDate} onChange={e => setForm({ ...form, effectiveDate: e.target.value })} /></div>
          <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
      )}
      <Table>
        <TableHeader><TableRow><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Expected</TableHead><TableHead>Min / Max</TableHead><TableHead>Process</TableHead><TableHead>Effective</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {(conversions ?? []).map(c => (
            <TableRow key={c.id}>
              <TableCell>{typeName(c.fromCommodityTypeId)}</TableCell>
              <TableCell>{typeName(c.toCommodityTypeId)}</TableCell>
              <TableCell className="font-medium">{Number(c.expectedRate).toLocaleString(undefined, { maximumFractionDigits: 6 })}</TableCell>
              <TableCell className="text-muted-foreground text-xs">{c.minRate ?? "—"} / {c.maxRate ?? "—"}</TableCell>
              <TableCell>{c.processType ?? "—"}</TableCell>
              <TableCell>{c.effectiveDate}</TableCell>
              <TableCell><Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}>Remove</Button></TableCell>
            </TableRow>
          ))}
          {(conversions ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="text-muted-foreground text-center py-6">No conversions defined.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}

const SAMPLE_STAGE_OPTS: Array<{ value: string; label: string }> = [
  { value: "field", label: "Field" },
  { value: "pre_offload", label: "Pre-Offload" },
  { value: "post_offload", label: "Post-Offload" },
  { value: "warehouse", label: "Warehouse" },
  { value: "processing", label: "Processing" },
  { value: "export", label: "Export" },
];

function QualitySpecsPanel({ type }: { type: CommodityType }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: specs } = useQuery<any[]>({
    queryKey: [`/api/commodity-types/${type.id}/quality-specs`],
    queryFn: () => api(`/api/commodity-types/${type.id}/quality-specs?includeInactive=true`),
  });
  const today = new Date().toISOString().slice(0, 10);
  const initial = {
    parameterName: "", parameterCode: "", unit: "%",
    minValue: "", maxValue: "", targetValue: "",
    methodUsed: "", affectsPrice: false, mandatory: true,
    appliesAtStages: [] as string[],
    effectiveDate: today, version: 1, notes: "",
  };
  const [form, setForm] = useState(initial);
  const create = useMutation({
    mutationFn: (b: any) => api(`/api/commodity-types/${type.id}/quality-specs`, { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/commodity-types/${type.id}/quality-specs`] });
      toast({ title: "Quality spec added" });
      setForm(initial);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const archive = useMutation({
    mutationFn: (id: string) => api(`/api/commodity-quality-specs/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`/api/commodity-types/${type.id}/quality-specs`] }),
  });
  const reactivate = useMutation({
    mutationFn: (id: string) => api(`/api/commodity-quality-specs/${id}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`/api/commodity-types/${type.id}/quality-specs`] }),
  });

  const toggleStage = (s: string) => {
    setForm(f => ({
      ...f,
      appliesAtStages: f.appliesAtStages.includes(s) ? f.appliesAtStages.filter(x => x !== s) : [...f.appliesAtStages, s],
    }));
  };

  const submit = () => {
    create.mutate({
      ...form,
      minValue: form.minValue === "" ? null : Number(form.minValue),
      maxValue: form.maxValue === "" ? null : Number(form.maxValue),
      targetValue: form.targetValue === "" ? null : Number(form.targetValue),
      methodUsed: form.methodUsed || undefined,
      notes: form.notes || undefined,
      appliesAtStages: form.appliesAtStages.length === 0 ? null : form.appliesAtStages,
    });
  };

  const formatRange = (s: any) => {
    const parts = [];
    if (s.minValue != null) parts.push(`≥ ${s.minValue}`);
    if (s.maxValue != null) parts.push(`≤ ${s.maxValue}`);
    return parts.join(" & ") || "—";
  };

  return (
    <div className="space-y-4 mt-3">
      <div className="text-sm text-muted-foreground">
        QC parameters for <strong>{type.name}</strong>. The Sampling Module auto-loads the latest active version of each parameter when a sample is captured.
        Parameters with <em>affects price</em> feed the QC pricing-adjustment formula at the buying station.
      </div>

      <div className="border rounded-md p-3 space-y-3 bg-muted/30">
        <div className="grid grid-cols-4 gap-2">
          <div><Label>Parameter Name</Label><Input value={form.parameterName} onChange={e => setForm({ ...form, parameterName: e.target.value })} placeholder="Moisture" data-testid="input-param-name" /></div>
          <div><Label>Code</Label><Input value={form.parameterCode} onChange={e => setForm({ ...form, parameterCode: e.target.value })} placeholder="moisture" data-testid="input-param-code" /></div>
          <div><Label>Unit</Label><Input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="%" /></div>
          <div><Label>Effective Date</Label><Input type="date" value={form.effectiveDate} onChange={e => setForm({ ...form, effectiveDate: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <div><Label>Min</Label><Input type="number" step="0.01" value={form.minValue} onChange={e => setForm({ ...form, minValue: e.target.value })} placeholder="11" data-testid="input-min" /></div>
          <div><Label>Max</Label><Input type="number" step="0.01" value={form.maxValue} onChange={e => setForm({ ...form, maxValue: e.target.value })} placeholder="13" data-testid="input-max" /></div>
          <div><Label>Target (optional)</Label><Input type="number" step="0.01" value={form.targetValue} onChange={e => setForm({ ...form, targetValue: e.target.value })} placeholder="12.5" /></div>
          <div><Label>Test Method</Label><Input value={form.methodUsed} onChange={e => setForm({ ...form, methodUsed: e.target.value })} placeholder="ISO 6673 oven" /></div>
        </div>
        <div>
          <Label>Applies at sample stages <span className="text-muted-foreground text-xs">(none = all stages)</span></Label>
          <div className="flex flex-wrap gap-2 mt-1">
            {SAMPLE_STAGE_OPTS.map(s => (
              <button key={s.value} type="button" onClick={() => toggleStage(s.value)}
                className={`text-xs px-2 py-1 rounded border ${form.appliesAtStages.includes(s.value) ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
                data-testid={`stage-${s.value}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.mandatory} onChange={e => setForm({ ...form, mandatory: e.target.checked })} />
            Mandatory (sampling must capture)
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.affectsPrice} onChange={e => setForm({ ...form, affectsPrice: e.target.checked })} />
            Affects price
          </label>
          <div className="flex items-center gap-2"><Label>Version</Label><Input className="w-16" type="number" min={1} value={form.version} onChange={e => setForm({ ...form, version: Number(e.target.value) || 1 })} /></div>
          <div className="flex-1"><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional context" /></div>
          <Button onClick={submit} disabled={!form.parameterName || !form.parameterCode || (form.minValue === "" && form.maxValue === "")} data-testid="btn-add-spec">Add Spec</Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Parameter</TableHead>
            <TableHead>Range</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Stages</TableHead>
            <TableHead>Flags</TableHead>
            <TableHead>Effective</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(specs ?? []).map(s => (
            <TableRow key={s.id} data-testid={`row-spec-${s.parameterCode}-${s.version}`}>
              <TableCell><div className="font-medium">{s.parameterName}</div><div className="text-xs text-muted-foreground">{s.parameterCode}</div></TableCell>
              <TableCell>{formatRange(s)} {s.unit ? <span className="text-muted-foreground">{s.unit}</span> : null}</TableCell>
              <TableCell>{s.targetValue ?? "—"}</TableCell>
              <TableCell className="text-xs">{s.methodUsed ?? "—"}</TableCell>
              <TableCell className="text-xs">{Array.isArray(s.appliesAtStages) && s.appliesAtStages.length > 0 ? s.appliesAtStages.join(", ") : <span className="text-muted-foreground">all</span>}</TableCell>
              <TableCell className="text-xs space-x-1">
                {s.mandatory && <Badge variant="outline">mandatory</Badge>}
                {s.affectsPrice && <Badge>price</Badge>}
              </TableCell>
              <TableCell>{s.effectiveDate}</TableCell>
              <TableCell>v{s.version}</TableCell>
              <TableCell><Badge variant={s.status === "active" ? "default" : "secondary"}>{s.status}</Badge></TableCell>
              <TableCell>
                {s.status === "active"
                  ? <Button size="sm" variant="ghost" onClick={() => archive.mutate(s.id)}>Archive</Button>
                  : <Button size="sm" variant="ghost" onClick={() => reactivate.mutate(s.id)}>Reactivate</Button>}
              </TableCell>
            </TableRow>
          ))}
          {(specs ?? []).length === 0 && <TableRow><TableCell colSpan={10} className="text-muted-foreground text-center py-6">No quality specs defined.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}

function SeasonsPanel({ type }: { type: CommodityType }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: seasons } = useQuery<any[]>({
    queryKey: [`/api/commodity-types/${type.id}/seasons`],
    queryFn: () => api(`/api/commodity-types/${type.id}/seasons`),
  });
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ seasonName: "", startDate: today, endDate: today, isActive: true, notes: "" });
  const create = useMutation({
    mutationFn: (b: any) => api(`/api/commodity-types/${type.id}/seasons`, { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/commodity-types/${type.id}/seasons`] });
      toast({ title: "Season added" });
      setForm({ seasonName: "", startDate: today, endDate: today, isActive: true, notes: "" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/commodity-seasons/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`/api/commodity-types/${type.id}/seasons`] }),
  });
  return (
    <div className="space-y-4 mt-3">
      <div className="text-sm text-muted-foreground">Define explicit harvest/buying windows. Used by procurement to validate that deliveries fall within an active season.</div>
      <div className="grid grid-cols-6 gap-2 items-end">
        <div className="col-span-2"><Label>Season Name</Label><Input value={form.seasonName} onChange={e => setForm({ ...form, seasonName: e.target.value })} placeholder="2026 Main Crop" data-testid="input-season-name" /></div>
        <div><Label>Start</Label><Input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} /></div>
        <div><Label>End</Label><Input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} /></div>
        <div className="col-span-1"><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
        <Button onClick={() => create.mutate({ ...form, notes: form.notes || undefined })} disabled={!form.seasonName || !form.startDate || !form.endDate} data-testid="btn-add-season">Add</Button>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Season</TableHead><TableHead>Start</TableHead><TableHead>End</TableHead><TableHead>Active</TableHead><TableHead>Notes</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {(seasons ?? []).map(s => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">{s.seasonName}</TableCell>
              <TableCell>{s.startDate}</TableCell>
              <TableCell>{s.endDate}</TableCell>
              <TableCell>{s.isActive ? <Badge>active</Badge> : <Badge variant="secondary">inactive</Badge>}</TableCell>
              <TableCell>{s.notes ?? "—"}</TableCell>
              <TableCell><Button size="sm" variant="ghost" onClick={() => remove.mutate(s.id)}>Remove</Button></TableCell>
            </TableRow>
          ))}
          {(seasons ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground text-center py-6">No seasons defined.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}
