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
import { Leaf, Plus, Tag, Coins, ArrowRightLeft, Calendar } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Commodity = { id: string; name: string; code: string; description: string | null; status: string; types: CommodityType[] };
type CommodityType = {
  id: string; commodityId: string; name: string; code: string; defaultUnit: string;
  defaultForm: string | null; harvestSeasonStartMonth: number | null; harvestSeasonEndMonth: number | null;
  status: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.error ?? `${r.status}`);
  }
  if (r.status === 204) return undefined as T;
  return r.json();
}

function seasonLabel(s: number | null, e: number | null): string {
  if (!s && !e) return "—";
  if (s && e) return `${MONTHS[s]} – ${MONTHS[e]}`;
  if (s) return `from ${MONTHS[s]}`;
  return `until ${MONTHS[e!]}`;
}

export default function CommoditiesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);

  const { data: commodities, isLoading } = useQuery<Commodity[]>({
    queryKey: ["/api/commodities"],
    queryFn: () => api<Commodity[]>("/api/commodities"),
  });

  const allTypes = useMemo(() => commodities?.flatMap(c => c.types.map(t => ({ ...t, commodityName: c.name }))) ?? [], [commodities]);
  const selectedType = useMemo(() => allTypes.find(t => t.id === selectedTypeId), [allTypes, selectedTypeId]);

  // ---- Create commodity ----
  const [cOpen, setCOpen] = useState(false);
  const [cForm, setCForm] = useState({ name: "", code: "", description: "" });
  const createCommodity = useMutation({
    mutationFn: (b: any) => api("/api/commodities", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/commodities"] }); setCOpen(false); setCForm({ name: "", code: "", description: "" }); toast({ title: "Commodity created" }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // ---- Create type ----
  const [tOpen, setTOpen] = useState(false);
  const [tForm, setTForm] = useState({ commodityId: "", name: "", code: "", defaultUnit: "kg", defaultForm: "", harvestSeasonStartMonth: "", harvestSeasonEndMonth: "" });
  const createType = useMutation({
    mutationFn: ({ commodityId, ...body }: any) => api(`/api/commodities/${commodityId}/types`, {
      method: "POST",
      body: JSON.stringify({
        ...body,
        harvestSeasonStartMonth: body.harvestSeasonStartMonth ? Number(body.harvestSeasonStartMonth) : null,
        harvestSeasonEndMonth: body.harvestSeasonEndMonth ? Number(body.harvestSeasonEndMonth) : null,
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commodities"] });
      setTOpen(false);
      setTForm({ commodityId: "", name: "", code: "", defaultUnit: "kg", defaultForm: "", harvestSeasonStartMonth: "", harvestSeasonEndMonth: "" });
      toast({ title: "Variety added" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><Leaf className="h-7 w-7 text-green-600" /> Commodities</h1>
          <p className="text-muted-foreground">Master catalog, varieties, daily prices, and conversion ratios.</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={cOpen} onOpenChange={setCOpen}>
            <DialogTrigger asChild><Button variant="outline" data-testid="btn-new-commodity"><Plus className="h-4 w-4 mr-1" /> New Commodity</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Commodity</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name</Label><Input value={cForm.name} onChange={e => setCForm({ ...cForm, name: e.target.value })} placeholder="Coffee" data-testid="input-commodity-name" /></div>
                <div><Label>Code</Label><Input value={cForm.code} onChange={e => setCForm({ ...cForm, code: e.target.value })} placeholder="coffee" data-testid="input-commodity-code" /></div>
                <div><Label>Description</Label><Input value={cForm.description} onChange={e => setCForm({ ...cForm, description: e.target.value })} placeholder="Optional" /></div>
              </div>
              <DialogFooter><Button onClick={() => createCommodity.mutate({ ...cForm, description: cForm.description || undefined })} disabled={!cForm.name || !cForm.code} data-testid="btn-save-commodity">Create</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={tOpen} onOpenChange={setTOpen}>
            <DialogTrigger asChild><Button data-testid="btn-new-type"><Plus className="h-4 w-4 mr-1" /> New Variety</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Variety</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Commodity</Label>
                  <Select value={tForm.commodityId} onValueChange={(v) => setTForm({ ...tForm, commodityId: v })}>
                    <SelectTrigger data-testid="select-type-commodity"><SelectValue placeholder="Pick a commodity" /></SelectTrigger>
                    <SelectContent>{commodities?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Variety Name</Label><Input value={tForm.name} onChange={e => setTForm({ ...tForm, name: e.target.value })} placeholder="Robusta" data-testid="input-type-name" /></div>
                  <div><Label>Code</Label><Input value={tForm.code} onChange={e => setTForm({ ...tForm, code: e.target.value })} placeholder="robusta" data-testid="input-type-code" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Default Unit</Label><Input value={tForm.defaultUnit} onChange={e => setTForm({ ...tForm, defaultUnit: e.target.value })} /></div>
                  <div><Label>Default Form</Label><Input value={tForm.defaultForm} onChange={e => setTForm({ ...tForm, defaultForm: e.target.value })} placeholder="cherry, parchment, ..." /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Harvest Season Start</Label>
                    <Select value={tForm.harvestSeasonStartMonth} onValueChange={(v) => setTForm({ ...tForm, harvestSeasonStartMonth: v })}>
                      <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
                      <SelectContent>{MONTHS.slice(1).map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Harvest Season End</Label>
                    <Select value={tForm.harvestSeasonEndMonth} onValueChange={(v) => setTForm({ ...tForm, harvestSeasonEndMonth: v })}>
                      <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
                      <SelectContent>{MONTHS.slice(1).map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter><Button onClick={() => createType.mutate(tForm)} disabled={!tForm.commodityId || !tForm.name || !tForm.code} data-testid="btn-save-type">Create</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? <Skeleton className="h-64" /> : (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Tag className="h-5 w-5" /> Catalog</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Commodity</TableHead><TableHead>Variety</TableHead><TableHead>Form</TableHead><TableHead><Calendar className="inline h-4 w-4 mr-1" />Harvest Season</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {allTypes.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No varieties yet — start by creating a commodity, then add a variety.</TableCell></TableRow>}
                {allTypes.map(t => (
                  <TableRow key={t.id} data-testid={`row-type-${t.code}`}>
                    <TableCell className="font-medium">{t.commodityName}</TableCell>
                    <TableCell>{t.name} <span className="text-muted-foreground text-xs">{t.code}</span></TableCell>
                    <TableCell>{t.defaultForm ?? "—"}</TableCell>
                    <TableCell>{seasonLabel(t.harvestSeasonStartMonth, t.harvestSeasonEndMonth)}</TableCell>
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
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{selectedType?.name} <span className="text-muted-foreground text-base font-normal">{selectedType?.code}</span></DialogTitle></DialogHeader>
          {selectedType && <ManagePanel type={selectedType} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ManagePanel({ type }: { type: CommodityType }) {
  return (
    <Tabs defaultValue="prices" className="w-full">
      <TabsList>
        <TabsTrigger value="prices"><Coins className="h-4 w-4 mr-1" /> Prices</TabsTrigger>
        <TabsTrigger value="conversions"><ArrowRightLeft className="h-4 w-4 mr-1" /> Conversions</TabsTrigger>
      </TabsList>
      <TabsContent value="prices"><PricesPanel type={type} /></TabsContent>
      <TabsContent value="conversions"><ConversionsPanel type={type} /></TabsContent>
    </Tabs>
  );
}

function PricesPanel({ type }: { type: CommodityType }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: prices } = useQuery<any[]>({
    queryKey: [`/api/commodity-types/${type.id}/prices`],
    queryFn: () => api(`/api/commodity-types/${type.id}/prices`),
  });
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ pricePerKg: "", currency: "UGX", effectiveDate: today, form: type.defaultForm ?? "", source: "" });
  const create = useMutation({
    mutationFn: (b: any) => api(`/api/commodity-types/${type.id}/prices`, { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/commodity-types/${type.id}/prices`] }); toast({ title: "Price set" }); setForm(f => ({ ...f, pricePerKg: "", source: "" })); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="space-y-4 mt-3">
      <div className="grid grid-cols-5 gap-2 items-end">
        <div><Label>Price / kg</Label><Input type="number" step="1" value={form.pricePerKg} onChange={e => setForm({ ...form, pricePerKg: e.target.value })} data-testid="input-price" /></div>
        <div><Label>Currency</Label><Input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} /></div>
        <div><Label>Effective Date</Label><Input type="date" value={form.effectiveDate} onChange={e => setForm({ ...form, effectiveDate: e.target.value })} /></div>
        <div><Label>Form</Label><Input value={form.form} onChange={e => setForm({ ...form, form: e.target.value })} placeholder="cherry / green_bean" /></div>
        <Button onClick={() => create.mutate({ ...form, pricePerKg: Number(form.pricePerKg), form: form.form || undefined })} disabled={!form.pricePerKg || !form.effectiveDate} data-testid="btn-set-price">Set Price</Button>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Effective</TableHead><TableHead>Form</TableHead><TableHead>Price/kg</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
        <TableBody>
          {(prices ?? []).map(p => (
            <TableRow key={p.id}><TableCell>{p.effectiveDate}</TableCell><TableCell>{p.form ?? "—"}</TableCell><TableCell>{p.currency} {Number(p.pricePerKg).toLocaleString()}</TableCell><TableCell>{p.source ?? "—"}</TableCell></TableRow>
          ))}
          {(prices ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground text-center py-6">No prices yet.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}

function ConversionsPanel({ type }: { type: CommodityType }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: conversions } = useQuery<any[]>({
    queryKey: [`/api/commodity-types/${type.id}/conversions`],
    queryFn: () => api(`/api/commodity-types/${type.id}/conversions`),
  });
  const [form, setForm] = useState({ fromForm: "", toForm: "", ratio: "", notes: "" });
  const create = useMutation({
    mutationFn: (b: any) => api(`/api/commodity-types/${type.id}/conversions`, { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/commodity-types/${type.id}/conversions`] }); toast({ title: "Conversion added" }); setForm({ fromForm: "", toForm: "", ratio: "", notes: "" }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/commodity-conversions/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`/api/commodity-types/${type.id}/conversions`] }),
  });
  return (
    <div className="space-y-4 mt-3">
      <div className="grid grid-cols-5 gap-2 items-end">
        <div><Label>From Form</Label><Input value={form.fromForm} onChange={e => setForm({ ...form, fromForm: e.target.value })} placeholder="cherry" data-testid="input-from-form" /></div>
        <div><Label>To Form</Label><Input value={form.toForm} onChange={e => setForm({ ...form, toForm: e.target.value })} placeholder="green_bean" data-testid="input-to-form" /></div>
        <div><Label>Ratio (out/in)</Label><Input type="number" step="0.0001" value={form.ratio} onChange={e => setForm({ ...form, ratio: e.target.value })} placeholder="0.2" data-testid="input-ratio" /></div>
        <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="5 kg cherry → 1 kg green bean" /></div>
        <Button onClick={() => create.mutate(form)} disabled={!form.fromForm || !form.toForm || !form.ratio} data-testid="btn-add-conversion">Add</Button>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Ratio</TableHead><TableHead>Notes</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {(conversions ?? []).map(c => (
            <TableRow key={c.id}>
              <TableCell>{c.fromForm}</TableCell><TableCell>{c.toForm}</TableCell>
              <TableCell>{Number(c.ratio).toLocaleString(undefined, { maximumFractionDigits: 6 })}</TableCell>
              <TableCell>{c.notes ?? "—"}</TableCell>
              <TableCell><Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}>Remove</Button></TableCell>
            </TableRow>
          ))}
          {(conversions ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground text-center py-6">No conversions defined.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}
