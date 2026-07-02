import { useMemo, useState } from "react";
import {
  useListLots,
  useGetWarehouseMassBalance,
  useListGradingProfiles,
  useGetGradingProfile,
  useListGradingRuns,
  useCreateGradingRun,
  useGetGradingRun,
  useListSiloBatches,
  useListSilos,
  useCreateSilo,
  useCreateSiloBatch,
  type GradingProfile,
  type GradingRun,
  type GradingRunOutput,
  type SiloBatch,
  type Silo,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { ChevronRight, Layers, Plus, Boxes } from "lucide-react";

function fmtKg(v?: number | string | null) {
  if (v == null) return "-";
  return `${Number(v).toLocaleString()} kg`;
}

function fmtPct(v?: number | string | null) {
  if (v == null) return "-";
  return `${Number(v).toFixed(2)}%`;
}

export default function WarehousePage() {
  const { data: lots, isLoading } = useListLots({});
  const { data: massBalance, isLoading: isLoadingMB } = useGetWarehouseMassBalance();

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Warehouse</h1>
        <p className="text-muted-foreground mt-1">Lot inventory, stream identity, and mass balance</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {["totalReceivedKg", "warehouseStockKg", "totalAllocatedKg", "totalExportedKg"].map(key => (
          <Card key={key}>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground capitalize">{key.replace(/([A-Z])/g, " $1").replace("Kg", " (kg)")}</CardTitle></CardHeader>
            <CardContent>{isLoadingMB ? <Skeleton className="h-7 w-20" /> : <div className="text-xl font-bold">{fmtKg((massBalance as any)?.[key])}</div>}</CardContent>
          </Card>
        ))}
      </div>

      {massBalance?.byStream && massBalance.byStream.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Mass Balance by Stream</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {massBalance.byStream.map((s: any) => (
                <div key={s.streamName} className="p-3 border rounded-lg">
                  <p className="font-medium text-sm">{s.streamName}</p>
                  <p className="text-muted-foreground text-xs">Stock</p>
                  <p className="font-bold">{fmtKg(s.stockKg)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {massBalance?.commodityStock && massBalance.commodityStock.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Graded Commodity Stock</CardTitle>
            <p className="text-sm text-muted-foreground">Net stock per commodity type after grading (sellable output booked in, input drawn down)</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {massBalance.commodityStock.map((c: any) => (
                <div key={c.commodityTypeId} className="p-3 border rounded-lg" data-testid={`commodity-stock-${c.commodityTypeId}`}>
                  <p className="font-medium text-sm">{c.commodityTypeName}</p>
                  <p className="text-muted-foreground text-xs">{c.commodityName}</p>
                  <p className={`font-bold ${Number(c.netStockKg) < 0 ? "text-destructive" : ""}`}>{fmtKg(c.netStockKg)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Lot Inventory</CardTitle>
          <Badge variant="secondary">{isLoading ? "..." : (lots?.length ?? 0)} lots</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lot Tag</TableHead>
                <TableHead>Weight (kg)</TableHead>
                <TableHead>Streams</TableHead>
                <TableHead>Silo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6}><Skeleton className="h-12 w-full" /></TableCell></TableRow>
              ) : lots && lots.length > 0 ? lots.map(lot => (
                <TableRow key={lot.id} data-testid={`lot-row-${lot.id}`}>
                  <TableCell className="font-mono text-sm font-medium">{lot.lotTag}</TableCell>
                  <TableCell>{fmtKg(lot.weightKg)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {lot.certificationStreams?.map((s: string) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{lot.siloId ?? "—"}</TableCell>
                  <TableCell><Badge variant={lot.status === "received" ? "secondary" : "default"}>{lot.status}</Badge></TableCell>
                  <TableCell>
                    <Link href={`/warehouse/${lot.id}`}><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={6} className="py-12 text-center text-muted-foreground">No lots in warehouse</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <GradingSection />
    </div>
  );
}

function GradingSection() {
  const { data: profiles } = useListGradingProfiles();
  const { data: batches } = useListSiloBatches();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [presetBatchId, setPresetBatchId] = useState<string | undefined>(undefined);
  const [viewRunId, setViewRunId] = useState<string | null>(null);
  const [filterBatchId, setFilterBatchId] = useState<string>("all");

  const activeProfiles = (profiles ?? []).filter((p: GradingProfile) => p.status === "active");
  const siloBatches = batches ?? [];

  const { data: runs, isLoading } = useListGradingRuns(
    filterBatchId !== "all" ? { siloBatchId: filterBatchId } : undefined,
  );

  const openRunDialog = (batchId?: string) => {
    setPresetBatchId(batchId);
    setDialogOpen(true);
  };

  return (
    <>
      <SiloBatchesSection
        batches={siloBatches}
        canGrade={activeProfiles.length > 0}
        onGrade={(id) => openRunDialog(id)}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Grading Runs</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Select value={filterBatchId} onValueChange={setFilterBatchId}>
              <SelectTrigger className="w-[220px]" data-testid="select-filter-silo-batch"><SelectValue placeholder="Filter by silo batch" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All silo batches</SelectItem>
                {siloBatches.map(b => <SelectItem key={b.id} value={b.id}>{b.batchNumber}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => openRunDialog(undefined)} disabled={activeProfiles.length === 0} data-testid="btn-run-grading">
              <Plus className="h-4 w-4 mr-1" /> Run grading
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {activeProfiles.length === 0 && (
            <p className="px-6 pb-4 text-sm text-muted-foreground">No active grading profiles. Define one under Commodities → variety → Grading first.</p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run #</TableHead>
                <TableHead>Profile</TableHead>
                <TableHead>Source batch</TableHead>
                <TableHead>Input</TableHead>
                <TableHead>Output</TableHead>
                <TableHead>Loss</TableHead>
                <TableHead>Date</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8}><Skeleton className="h-12 w-full" /></TableCell></TableRow>
              ) : runs && runs.length > 0 ? runs.map((run: GradingRun) => (
                <TableRow key={run.id} data-testid={`grading-run-row-${run.id}`}>
                  <TableCell className="font-mono text-sm font-medium">{run.runNumber}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{run.gradingProfileId.slice(0, 8)}…</TableCell>
                  <TableCell className="text-sm">
                    {run.siloBatchNumber
                      ? <span className="font-mono" data-testid={`run-source-${run.id}`}>{run.siloBatchNumber}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>{fmtKg(run.inputWeightKg)}</TableCell>
                  <TableCell>{fmtKg(run.totalOutputKg)}</TableCell>
                  <TableCell>{fmtKg(run.lossKg)} <span className="text-muted-foreground text-xs">({fmtPct(run.lossPct)})</span></TableCell>
                  <TableCell className="text-muted-foreground text-sm">{run.createdAt?.slice(0, 10)}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => setViewRunId(run.id)} data-testid={`btn-view-run-${run.id}`}>View</Button>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={8} className="py-12 text-center text-muted-foreground">No grading runs yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {dialogOpen && (
        <RunGradingDialog
          profiles={activeProfiles}
          batches={siloBatches}
          presetBatchId={presetBatchId}
          onClose={() => setDialogOpen(false)}
        />
      )}
      {viewRunId && (
        <RunResultsDialog runId={viewRunId} onClose={() => setViewRunId(null)} />
      )}
    </>
  );
}

function SiloBatchesSection({ batches, canGrade, onGrade }: { batches: SiloBatch[]; canGrade: boolean; onGrade: (batchId: string) => void }) {
  const [newBatchOpen, setNewBatchOpen] = useState(false);
  const [newSiloOpen, setNewSiloOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Boxes className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Silo Batches</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setNewSiloOpen(true)} data-testid="btn-new-silo"><Plus className="h-4 w-4 mr-1" /> New silo</Button>
          <Button size="sm" onClick={() => setNewBatchOpen(true)} data-testid="btn-new-silo-batch"><Plus className="h-4 w-4 mr-1" /> New batch</Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Batch #</TableHead>
              <TableHead>Silo</TableHead>
              <TableHead>Streams</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Input</TableHead>
              <TableHead>Available</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.length > 0 ? batches.map(b => {
              const avail = Number(b.availableWeightKg);
              return (
                <TableRow key={b.id} data-testid={`silo-batch-row-${b.id}`}>
                  <TableCell className="font-mono text-sm font-medium">{b.batchNumber}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{b.siloName ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {(b.streams ?? []).map((s: string) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant={b.status === "CLOSED" ? "secondary" : "default"}>{b.status}</Badge></TableCell>
                  <TableCell>{fmtKg(b.inputWeightKg)}</TableCell>
                  <TableCell className={avail <= 0 ? "text-muted-foreground" : "font-medium"} data-testid={`silo-batch-available-${b.id}`}>{fmtKg(b.availableWeightKg)}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canGrade || avail <= 0}
                      onClick={() => onGrade(b.id)}
                      data-testid={`btn-grade-batch-${b.id}`}
                    >
                      Grade
                    </Button>
                  </TableCell>
                </TableRow>
              );
            }) : (
              <TableRow><TableCell colSpan={7} className="py-12 text-center text-muted-foreground">No silo batches yet. Create one to grade from warehouse stock.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      {newBatchOpen && <NewSiloBatchDialog onClose={() => setNewBatchOpen(false)} onNeedSilo={() => { setNewBatchOpen(false); setNewSiloOpen(true); }} />}
      {newSiloOpen && <NewSiloDialog onClose={() => setNewSiloOpen(false)} />}
    </Card>
  );
}

function NewSiloDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [stream, setStream] = useState("");
  const [commodityType, setCommodityType] = useState("");
  const [capacityKg, setCapacityKg] = useState("");
  const create = useCreateSilo();

  const canSubmit = !!name.trim() && !!stream.trim();

  const submit = () => {
    create.mutate(
      { data: { name: name.trim(), stream: stream.trim(), commodityType: commodityType.trim() || undefined, capacityKg: capacityKg ? Number(capacityKg) : undefined } },
      {
        onSuccess: () => { toast({ title: "Silo created" }); onClose(); },
        onError: (e: any) => toast({ title: "Failed", description: e?.message ?? "Could not create silo", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New silo</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} data-testid="input-silo-name" /></div>
          <div><Label>Stream</Label><Input value={stream} onChange={e => setStream(e.target.value)} placeholder="e.g. Organic" data-testid="input-silo-stream" /></div>
          <div><Label>Commodity type (optional)</Label><Input value={commodityType} onChange={e => setCommodityType(e.target.value)} /></div>
          <div><Label>Capacity (kg, optional)</Label><Input type="number" step="0.01" value={capacityKg} onChange={e => setCapacityKg(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit || create.isPending} data-testid="btn-submit-silo">{create.isPending ? "Saving…" : "Create silo"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewSiloBatchDialog({ onClose, onNeedSilo }: { onClose: () => void; onNeedSilo: () => void }) {
  const { toast } = useToast();
  const { data: silos } = useListSilos();
  const [siloId, setSiloId] = useState("");
  const [inputWeightKg, setInputWeightKg] = useState("");
  const [streams, setStreams] = useState("");
  const create = useCreateSiloBatch();

  const siloList = silos ?? [];
  const input = Number(inputWeightKg) || 0;
  const canSubmit = !!siloId && input > 0;

  const submit = () => {
    const streamList = streams.split(",").map(s => s.trim()).filter(Boolean);
    create.mutate(
      { data: { siloId, inputWeightKg: input, streams: streamList.length ? streamList : undefined } },
      {
        onSuccess: () => { toast({ title: "Silo batch created" }); onClose(); },
        onError: (e: any) => toast({ title: "Failed", description: e?.message ?? "Could not create batch", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New silo batch</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Silo</Label>
            {siloList.length > 0 ? (
              <Select value={siloId} onValueChange={setSiloId}>
                <SelectTrigger data-testid="select-batch-silo"><SelectValue placeholder="Select silo" /></SelectTrigger>
                <SelectContent>{siloList.map((s: Silo) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.stream})</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                No silos yet.
                <Button size="sm" variant="link" className="px-0" onClick={onNeedSilo}>Create a silo first</Button>
              </div>
            )}
          </div>
          <div><Label>Input weight (kg)</Label><Input type="number" step="0.01" value={inputWeightKg} onChange={e => setInputWeightKg(e.target.value)} data-testid="input-batch-weight" /></div>
          <div><Label>Streams (comma-separated, optional)</Label><Input value={streams} onChange={e => setStreams(e.target.value)} placeholder="defaults to silo stream" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit || create.isPending} data-testid="btn-submit-silo-batch">{create.isPending ? "Saving…" : "Create batch"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunGradingDialog({ profiles, batches, presetBatchId, onClose }: { profiles: GradingProfile[]; batches: SiloBatch[]; presetBatchId?: string; onClose: () => void }) {
  const { toast } = useToast();
  const [profileId, setProfileId] = useState<string>("");
  const presetBatch = useMemo(() => batches.find(b => b.id === presetBatchId), [batches, presetBatchId]);
  const [siloBatchId, setSiloBatchId] = useState<string>(presetBatchId ?? "none");
  const [inputWeightKg, setInputWeightKg] = useState(presetBatch ? presetBatch.availableWeightKg : "");
  const [notes, setNotes] = useState("");
  const [actuals, setActuals] = useState<Record<string, string>>({});

  const { data: detail } = useGetGradingProfile(profileId, {
    query: { enabled: !!profileId, queryKey: ["getGradingProfile", profileId] },
  });
  const create = useCreateGradingRun();

  const selectedBatch = batches.find(b => b.id === siloBatchId);
  const input = Number(inputWeightKg) || 0;
  const outputs = detail?.outputs ?? [];
  const totalActual = outputs.reduce((s, o) => s + (Number(actuals[o.id]) || 0), 0);
  const loss = Math.max(0, input - totalActual);
  const overInput = totalActual - input > 0.01;
  const overAvailable = !!selectedBatch && input - Number(selectedBatch.availableWeightKg) > 0.01;

  const canSubmit = !!profileId && input > 0 && outputs.length > 0 && !overInput && !overAvailable &&
    outputs.every(o => actuals[o.id] !== undefined && actuals[o.id] !== "" && Number(actuals[o.id]) >= 0);

  const onSelectBatch = (v: string) => {
    setSiloBatchId(v);
    const b = batches.find(x => x.id === v);
    if (b) setInputWeightKg(b.availableWeightKg);
  };

  const submit = () => {
    create.mutate(
      {
        data: {
          gradingProfileId: profileId,
          inputWeightKg: input,
          siloBatchId: siloBatchId !== "none" ? siloBatchId : undefined,
          notes: notes.trim() || undefined,
          outputs: outputs.map(o => ({ gradingProfileOutputId: o.id, actualWeightKg: Number(actuals[o.id]) || 0 })),
        },
      },
      {
        onSuccess: () => { toast({ title: "Grading run recorded" }); onClose(); },
        onError: (e: any) => toast({ title: "Failed", description: e?.message ?? "Could not record run", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Run grading</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1">
              <Label>Profile</Label>
              <Select value={profileId} onValueChange={(v) => { setProfileId(v); setActuals({}); }}>
                <SelectTrigger data-testid="select-grading-profile"><SelectValue placeholder="Select profile" /></SelectTrigger>
                <SelectContent>{profiles.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Silo batch (optional)</Label>
              <Select value={siloBatchId} onValueChange={onSelectBatch}>
                <SelectTrigger data-testid="select-run-silo-batch"><SelectValue placeholder="Ad-hoc (no batch)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ad-hoc (no batch)</SelectItem>
                  {batches.map(b => (
                    <SelectItem key={b.id} value={b.id} disabled={Number(b.availableWeightKg) <= 0 && b.id !== presetBatchId}>
                      {b.batchNumber} · {fmtKg(b.availableWeightKg)} avail
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Input weight (kg)</Label>
              <Input type="number" step="0.01" value={inputWeightKg} onChange={e => setInputWeightKg(e.target.value)} data-testid="input-grading-input-kg" />
              {selectedBatch && (
                <p className={`text-xs mt-1 ${overAvailable ? "text-destructive" : "text-muted-foreground"}`} data-testid="text-available-hint">
                  {overAvailable ? "Exceeds available!" : `Available: ${fmtKg(selectedBatch.availableWeightKg)}`}
                </p>
              )}
            </div>
          </div>

          {profileId && outputs.length > 0 && (
            <div className="space-y-2">
              <Label>Actual weight per grade</Label>
              <Table>
                <TableHeader><TableRow><TableHead>Grade</TableHead><TableHead>Type</TableHead><TableHead>Expected %</TableHead><TableHead className="w-[22%]">Actual (kg)</TableHead><TableHead>Actual %</TableHead></TableRow></TableHeader>
                <TableBody>
                  {outputs.map(o => {
                    const actual = Number(actuals[o.id]) || 0;
                    const actualPct = input > 0 ? (actual / input) * 100 : 0;
                    return (
                      <TableRow key={o.id}>
                        <TableCell className="font-medium">{o.label ?? "Grade"}</TableCell>
                        <TableCell>{o.isSellable ? <Badge variant="outline">Sellable</Badge> : <Badge variant="secondary">Loss</Badge>}</TableCell>
                        <TableCell>{fmtPct(o.expectedYieldPct)}</TableCell>
                        <TableCell><Input type="number" step="0.01" value={actuals[o.id] ?? ""} onChange={e => setActuals(a => ({ ...a, [o.id]: e.target.value }))} data-testid={`input-actual-${o.id}`} /></TableCell>
                        <TableCell className="text-muted-foreground">{input > 0 ? fmtPct(actualPct) : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex justify-between text-sm">
                <span className={overInput ? "text-destructive font-medium" : "text-muted-foreground"}>
                  Total graded: {totalActual.toFixed(2)} kg{overInput ? " (exceeds input!)" : ""}
                </span>
                <span className="text-muted-foreground">Derived loss: <strong>{loss.toFixed(2)} kg</strong> ({input > 0 ? ((loss / input) * 100).toFixed(2) : "0.00"}%)</span>
              </div>
            </div>
          )}

          <div><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit || create.isPending} data-testid="btn-submit-grading-run">{create.isPending ? "Recording…" : "Record run"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunResultsDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { data: run, isLoading } = useGetGradingRun(runId);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{run?.runNumber ?? "Grading run"}{run?.profileName ? ` — ${run.profileName}` : ""}</DialogTitle>
        </DialogHeader>
        {isLoading || !run ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3 text-sm">
              <div className="p-3 border rounded-lg"><p className="text-muted-foreground text-xs">Input</p><p className="font-bold">{fmtKg(run.inputWeightKg)}</p></div>
              <div className="p-3 border rounded-lg"><p className="text-muted-foreground text-xs">Total output</p><p className="font-bold">{fmtKg(run.totalOutputKg)}</p></div>
              <div className="p-3 border rounded-lg"><p className="text-muted-foreground text-xs">Loss</p><p className="font-bold">{fmtKg(run.lossKg)}</p></div>
              <div className="p-3 border rounded-lg"><p className="text-muted-foreground text-xs">Loss %</p><p className="font-bold">{fmtPct(run.lossPct)}</p></div>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Grade</TableHead><TableHead>Type</TableHead><TableHead>Expected %</TableHead><TableHead>Actual kg</TableHead><TableHead>Actual %</TableHead><TableHead>Variance</TableHead></TableRow></TableHeader>
              <TableBody>
                {run.outputs.map((o: GradingRunOutput) => {
                  const variance = Number(o.variancePct);
                  return (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.label ?? "Grade"}</TableCell>
                      <TableCell>{o.isSellable ? <Badge variant="outline">Sellable</Badge> : <Badge variant="secondary">Loss</Badge>}</TableCell>
                      <TableCell>{fmtPct(o.expectedYieldPct)}</TableCell>
                      <TableCell>{fmtKg(o.actualWeightKg)}</TableCell>
                      <TableCell>{fmtPct(o.actualYieldPct)}</TableCell>
                      <TableCell className={variance < -0.01 ? "text-destructive" : variance > 0.01 ? "text-green-600" : "text-muted-foreground"}>
                        {variance > 0 ? "+" : ""}{variance.toFixed(2)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {run.notes && <p className="text-sm text-muted-foreground">Notes: {run.notes}</p>}
          </div>
        )}
        <DialogFooter><Button variant="ghost" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
