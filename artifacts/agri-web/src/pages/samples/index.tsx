import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { TestTube, Plus, MapPin, Loader2, Trash2 } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

const STAGE_OPTIONS = [
  { value: "field", label: "Field" },
  { value: "pre_offload", label: "Pre-Offload" },
  { value: "post_offload", label: "Post-Offload" },
  { value: "warehouse", label: "Warehouse" },
  { value: "processing", label: "Processing" },
  { value: "export", label: "Export" },
] as const;
const stageLabel = (v: string) => STAGE_OPTIONS.find(s => s.value === v)?.label ?? v;

const METHOD_OPTIONS = [
  { value: "grab", label: "Grab" },
  { value: "composite", label: "Composite" },
  { value: "incremental", label: "Incremental" },
] as const;

// Per-stage entity binding rules from the brief: which upstream entity each stage's sample
// must link to. Drives the linkedEntityType selector and label.
const LINKED_BY_STAGE: Record<string, { value: string; label: string }> = {
  field: { value: "farmer", label: "Farmer" },
  pre_offload: { value: "batch", label: "Batch" },
  post_offload: { value: "lot", label: "Lot" },
  warehouse: { value: "lot", label: "Lot" },
  processing: { value: "silo_batch", label: "Silo Batch" },
  export: { value: "container", label: "Container" },
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  collected: "secondary",
  lab_pending: "outline",
  completed: "default",
  rejected: "destructive",
  voided: "secondary",
};

type Sample = {
  id: string; sampleCode: string;
  commodityTypeId: string;
  samplingConfigId: string | null; samplingConfigVersion: number | null;
  stage: string; linkedEntityType: string; linkedEntityId: string;
  samplingMethod: string;
  collectionDate: string;
  latitude: string | null; longitude: string | null; gpsAccuracyM: string | null;
  collectorId: string | null;
  sampleWeightKg: string | null; subSampleCount: number;
  containerType: string | null; sealNumber: string | null;
  photoUrls: string[];
  status: string; notes: string | null;
  clientGeneratedId: string | null; clientCreatedAt: string | null;
  syncedAt: string; createdAt: string;
};
type CommodityType = { id: string; name: string; code: string; commodityName?: string };
type Commodity = { id: string; name: string; types: { id: string; name: string; code: string }[] };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return customFetch<T>(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

export default function SamplesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [filters, setFilters] = useState({ stage: "all", status: "all", commodityTypeId: "all" });
  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.stage !== "all") p.set("stage", filters.stage);
    if (filters.status !== "all") p.set("status", filters.status);
    if (filters.commodityTypeId !== "all") p.set("commodityTypeId", filters.commodityTypeId);
    p.set("limit", "100");
    return p.toString();
  }, [filters]);

  const { data: list, isLoading } = useQuery<{ rows: Sample[]; total: number }>({
    queryKey: ["/api/samples", queryString],
    queryFn: () => api(`/api/samples?${queryString}`),
  });

  const { data: commodities } = useQuery<Commodity[]>({
    queryKey: ["/api/commodities"],
    queryFn: () => api("/api/commodities"),
  });
  const types: CommodityType[] = useMemo(
    () => commodities?.flatMap(c => c.types.map(t => ({ ...t, commodityName: c.name }))) ?? [],
    [commodities]
  );
  const typeName = (id: string) => {
    const t = types.find(x => x.id === id);
    return t ? `${t.commodityName} · ${t.name}` : id.slice(0, 8);
  };

  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Sample | null>(null);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <TestTube className="h-7 w-7 text-purple-600" /> Samples
          </h1>
          <p className="text-muted-foreground">Capture and trace physical samples drawn at any operational stage. Each sample carries an auto-generated code, GPS, collector identity, and a snapshot of the sampling rule active at capture.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="btn-new-sample"><Plus className="h-4 w-4 mr-1" /> Capture Sample</Button>
          </DialogTrigger>
          <CaptureDialog
            types={types}
            onClose={() => setOpen(false)}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: ["/api/samples"] });
              setOpen(false);
              toast({ title: "Sample captured" });
            }}
            onError={(m) => toast({ title: "Failed", description: m, variant: "destructive" })}
          />
        </Dialog>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Stage</Label>
            <Select value={filters.stage} onValueChange={(v) => setFilters(f => ({ ...f, stage: v }))}>
              <SelectTrigger data-testid="filter-stage"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                {STAGE_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={filters.status} onValueChange={(v) => setFilters(f => ({ ...f, status: v }))}>
              <SelectTrigger data-testid="filter-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="collected">Collected</SelectItem>
                <SelectItem value="lab_pending">Lab Pending</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="voided">Voided</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Commodity Variety</Label>
            <Select value={filters.commodityTypeId} onValueChange={(v) => setFilters(f => ({ ...f, commodityTypeId: v }))}>
              <SelectTrigger data-testid="filter-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All varieties</SelectItem>
                {types.map(t => <SelectItem key={t.id} value={t.id}>{t.commodityName} · {t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? <Skeleton className="h-64" /> : (
        <Card>
          <CardHeader><CardTitle>{list?.total ?? 0} sample{(list?.total ?? 0) === 1 ? "" : "s"}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Commodity</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Linked To</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Collected</TableHead>
                <TableHead>GPS</TableHead>
                <TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(list?.rows ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No samples captured yet.
                  </TableCell></TableRow>
                )}
                {(list?.rows ?? []).map(s => (
                  <TableRow key={s.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setDetail(s)} data-testid={`row-sample-${s.sampleCode}`}>
                    <TableCell className="font-mono text-xs">{s.sampleCode}</TableCell>
                    <TableCell className="text-sm">{typeName(s.commodityTypeId)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{stageLabel(s.stage)}</Badge></TableCell>
                    <TableCell className="text-xs"><span className="text-muted-foreground capitalize">{s.linkedEntityType.replace("_", " ")}:</span> {s.linkedEntityId.slice(0, 12)}</TableCell>
                    <TableCell className="text-xs capitalize">{s.samplingMethod}</TableCell>
                    <TableCell className="text-xs">{new Date(s.collectionDate).toLocaleString("en-UG")}</TableCell>
                    <TableCell className="text-xs">
                      {s.latitude && s.longitude
                        ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{Number(s.latitude).toFixed(4)}, {Number(s.longitude).toFixed(4)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell><Badge variant={STATUS_VARIANTS[s.status] ?? "secondary"}>{s.status.replace("_", " ")}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {detail && (
        <Dialog open onOpenChange={(o) => !o && setDetail(null)}>
          <DetailDialog sample={detail} typeName={typeName(detail.commodityTypeId)} onClose={() => setDetail(null)}
            onUpdated={() => { qc.invalidateQueries({ queryKey: ["/api/samples"] }); setDetail(null); toast({ title: "Sample updated" }); }}
            onError={(m) => toast({ title: "Failed", description: m, variant: "destructive" })} />
        </Dialog>
      )}
    </div>
  );
}

// =================================================================================================
// Capture dialog — supports browser GPS auto-fill, photo URL list, and offline-style idempotency
// via clientGeneratedId. The collection date defaults to "now" but is editable so field officers
// can correct it after the fact.
// =================================================================================================
function CaptureDialog({
  types, onClose, onSaved, onError,
}: {
  types: CommodityType[];
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState({
    commodityTypeId: "",
    stage: "field",
    linkedEntityType: "farmer",
    linkedEntityId: "",
    samplingMethod: "grab",
    collectionDate: new Date().toISOString().slice(0, 16), // datetime-local format
    latitude: "",
    longitude: "",
    gpsAccuracyM: "",
    sampleWeightKg: "",
    subSampleCount: "1",
    containerType: "",
    sealNumber: "",
    photoUrlsRaw: "",
    notes: "",
  });
  const [gpsLoading, setGpsLoading] = useState(false);

  const setField = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }));
  // When stage changes, auto-update linkedEntityType to the stage-appropriate default.
  const onStageChange = (v: string) => {
    setForm(f => ({ ...f, stage: v, linkedEntityType: LINKED_BY_STAGE[v]?.value ?? f.linkedEntityType }));
  };

  const captureGPS = () => {
    if (!navigator.geolocation) { onError("Geolocation not supported in this browser"); return; }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm(f => ({
          ...f,
          latitude: pos.coords.latitude.toFixed(7),
          longitude: pos.coords.longitude.toFixed(7),
          gpsAccuracyM: pos.coords.accuracy.toFixed(1),
        }));
        setGpsLoading(false);
      },
      (err) => { onError(`GPS failed: ${err.message}`); setGpsLoading(false); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const save = useMutation({
    mutationFn: (b: any) => api("/api/samples", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => onSaved(),
    onError: (e: any) => onError(e.message),
  });

  const submit = () => {
    const photos = form.photoUrlsRaw.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    save.mutate({
      commodityTypeId: form.commodityTypeId,
      stage: form.stage,
      linkedEntityType: form.linkedEntityType,
      linkedEntityId: form.linkedEntityId.trim(),
      samplingMethod: form.samplingMethod,
      collectionDate: new Date(form.collectionDate).toISOString(),
      latitude: form.latitude || null,
      longitude: form.longitude || null,
      gpsAccuracyM: form.gpsAccuracyM || null,
      sampleWeightKg: form.sampleWeightKg || null,
      subSampleCount: Number(form.subSampleCount) || 1,
      containerType: form.containerType || null,
      sealNumber: form.sealNumber || null,
      photoUrls: photos,
      notes: form.notes || null,
      // Generate a client id even from web — it's a no-op for online flows but lets the mobile
      // sync queue use the same endpoint without server-side branching.
      clientGeneratedId: crypto.randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    });
  };

  const linkedLabel = LINKED_BY_STAGE[form.stage]?.label ?? "Entity";
  const isValid = form.commodityTypeId && form.linkedEntityId.trim() && form.collectionDate;

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Capture New Sample</DialogTitle></DialogHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Commodity Variety <span className="text-destructive">*</span></Label>
            <Select value={form.commodityTypeId} onValueChange={(v) => setField("commodityTypeId", v)}>
              <SelectTrigger data-testid="select-commodity-type"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {types.map(t => <SelectItem key={t.id} value={t.id}>{t.commodityName} · {t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Stage <span className="text-destructive">*</span></Label>
            <Select value={form.stage} onValueChange={onStageChange}>
              <SelectTrigger data-testid="select-stage"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STAGE_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Linked Entity Type <span className="text-destructive">*</span></Label>
            <Select value={form.linkedEntityType} onValueChange={(v) => setField("linkedEntityType", v)}>
              <SelectTrigger data-testid="select-linked-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="farmer">Farmer (Field stage)</SelectItem>
                <SelectItem value="batch">Batch (Bulking)</SelectItem>
                <SelectItem value="lot">Lot (Buying station / Warehouse)</SelectItem>
                <SelectItem value="silo_batch">Silo Batch (Processing)</SelectItem>
                <SelectItem value="container">Container (Export)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{linkedLabel} ID <span className="text-destructive">*</span></Label>
            <Input value={form.linkedEntityId} onChange={e => setField("linkedEntityId", e.target.value)} placeholder="UUID or reference" data-testid="input-linked-id" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Sampling Method <span className="text-destructive">*</span></Label>
            <Select value={form.samplingMethod} onValueChange={(v) => setField("samplingMethod", v)}>
              <SelectTrigger data-testid="select-method"><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHOD_OPTIONS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Collection Date / Time <span className="text-destructive">*</span></Label>
            <Input type="datetime-local" value={form.collectionDate} onChange={e => setField("collectionDate", e.target.value)} data-testid="input-collected-at" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <Label>GPS Location</Label>
            <Button type="button" variant="outline" size="sm" onClick={captureGPS} disabled={gpsLoading} data-testid="btn-capture-gps">
              {gpsLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <MapPin className="h-3 w-3 mr-1" />}
              Use my location
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label className="text-xs">Latitude</Label><Input value={form.latitude} onChange={e => setField("latitude", e.target.value)} placeholder="0.3476" /></div>
            <div><Label className="text-xs">Longitude</Label><Input value={form.longitude} onChange={e => setField("longitude", e.target.value)} placeholder="32.5825" /></div>
            <div><Label className="text-xs">Accuracy (m)</Label><Input value={form.gpsAccuracyM} onChange={e => setField("gpsAccuracyM", e.target.value)} placeholder="5.0" /></div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><Label>Sample Weight (kg)</Label><Input type="number" step="0.001" value={form.sampleWeightKg} onChange={e => setField("sampleWeightKg", e.target.value)} placeholder="0.500" /></div>
          <div><Label>Sub-sample Count</Label><Input type="number" min="1" value={form.subSampleCount} onChange={e => setField("subSampleCount", e.target.value)} /></div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><Label>Container Type</Label><Input value={form.containerType} onChange={e => setField("containerType", e.target.value)} placeholder="Sealed jute bag" /></div>
          <div><Label>Seal Number</Label><Input value={form.sealNumber} onChange={e => setField("sealNumber", e.target.value)} placeholder="SL-2026-0093" /></div>
        </div>

        <div>
          <Label>Photo URLs <span className="text-xs text-muted-foreground">(one per line, or comma-separated)</span></Label>
          <Textarea rows={2} value={form.photoUrlsRaw} onChange={e => setField("photoUrlsRaw", e.target.value)} placeholder="https://…/photo1.jpg" />
        </div>

        <div>
          <Label>Notes</Label>
          <Textarea rows={2} value={form.notes} onChange={e => setField("notes", e.target.value)} placeholder="Visual observations, anomalies…" />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!isValid || save.isPending} data-testid="btn-save-sample">
          {save.isPending ? "Saving..." : "Capture Sample"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// =================================================================================================
// Detail dialog — view full sample, advance status (e.g. collected → lab_pending → completed),
// add/replace photo URLs, edit notes. Code, type, link, GPS, collector are immutable.
// =================================================================================================
function DetailDialog({
  sample, typeName, onClose, onUpdated, onError,
}: {
  sample: Sample;
  typeName: string;
  onClose: () => void;
  onUpdated: () => void;
  onError: (msg: string) => void;
}) {
  const [status, setStatus] = useState(sample.status);
  const [notes, setNotes] = useState(sample.notes ?? "");
  const [photosRaw, setPhotosRaw] = useState(sample.photoUrls.join("\n"));

  const update = useMutation({
    mutationFn: (b: any) => api(`/api/samples/${sample.id}`, { method: "PATCH", body: JSON.stringify(b) }),
    onSuccess: () => onUpdated(),
    onError: (e: any) => onError(e.message),
  });

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle className="flex items-center gap-2 font-mono text-base">{sample.sampleCode}</DialogTitle></DialogHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div><span className="text-muted-foreground">Commodity:</span> {typeName}</div>
          <div><span className="text-muted-foreground">Stage:</span> {stageLabel(sample.stage)}</div>
          <div><span className="text-muted-foreground">Linked to:</span> <span className="capitalize">{sample.linkedEntityType.replace("_", " ")}</span></div>
          <div><span className="text-muted-foreground">Linked ID:</span> <span className="font-mono text-xs">{sample.linkedEntityId}</span></div>
          <div><span className="text-muted-foreground">Method:</span> <span className="capitalize">{sample.samplingMethod}</span></div>
          <div><span className="text-muted-foreground">Collected:</span> {new Date(sample.collectionDate).toLocaleString("en-UG")}</div>
          <div><span className="text-muted-foreground">Weight:</span> {sample.sampleWeightKg ? `${Number(sample.sampleWeightKg)} kg` : "—"}</div>
          <div><span className="text-muted-foreground">Sub-samples:</span> {sample.subSampleCount}</div>
          <div><span className="text-muted-foreground">Container:</span> {sample.containerType ?? "—"}</div>
          <div><span className="text-muted-foreground">Seal:</span> {sample.sealNumber ?? "—"}</div>
          <div><span className="text-muted-foreground">GPS:</span> {sample.latitude && sample.longitude ? `${Number(sample.latitude).toFixed(5)}, ${Number(sample.longitude).toFixed(5)}` : "—"}</div>
          <div><span className="text-muted-foreground">Accuracy:</span> {sample.gpsAccuracyM ? `${Number(sample.gpsAccuracyM)} m` : "—"}</div>
          <div><span className="text-muted-foreground">Config version:</span> {sample.samplingConfigVersion ?? <span className="italic">no rule snapshot</span>}</div>
          <div><span className="text-muted-foreground">Synced:</span> {new Date(sample.syncedAt).toLocaleString("en-UG")}</div>
        </div>

        <div>
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger data-testid="select-update-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="collected">Collected</SelectItem>
              <SelectItem value="lab_pending">Lab Pending</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="voided">Voided</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Photo URLs</Label>
          <Textarea rows={3} value={photosRaw} onChange={e => setPhotosRaw(e.target.value)} placeholder="One URL per line" />
          {sample.photoUrls.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {sample.photoUrls.map((u, i) => (
                <a key={i} href={u} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline truncate max-w-[200px]">{u}</a>
              ))}
            </div>
          )}
        </div>

        <div>
          <Label>Notes</Label>
          <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Close</Button>
        <Button
          onClick={() => update.mutate({
            status,
            notes: notes || null,
            photoUrls: photosRaw.split(/[\n,]/).map(s => s.trim()).filter(Boolean),
          })}
          disabled={update.isPending}
          data-testid="btn-update-sample"
        >
          {update.isPending ? "Saving..." : "Save changes"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
