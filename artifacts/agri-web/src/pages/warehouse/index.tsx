import { useMemo, useState } from "react";
import {
  useListLots,
  useGetWarehouseMassBalance,
  useListGradingProfiles,
  useGetGradingProfile,
  useListGradingRuns,
  useCreateGradingRun,
  useGetGradingRun,
  type GradingProfile,
  type GradingRun,
  type GradingRunOutput,
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
import { ChevronRight, Warehouse, Layers, Plus } from "lucide-react";

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
  const { data: runs, isLoading } = useListGradingRuns();
  const { data: profiles } = useListGradingProfiles();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewRunId, setViewRunId] = useState<string | null>(null);

  const activeProfiles = (profiles ?? []).filter((p: GradingProfile) => p.status === "active");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Grading Runs</CardTitle>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)} disabled={activeProfiles.length === 0} data-testid="btn-run-grading">
          <Plus className="h-4 w-4 mr-1" /> Run grading
        </Button>
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
              <TableHead>Input</TableHead>
              <TableHead>Output</TableHead>
              <TableHead>Loss</TableHead>
              <TableHead>Date</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7}><Skeleton className="h-12 w-full" /></TableCell></TableRow>
            ) : runs && runs.length > 0 ? runs.map((run: GradingRun) => (
              <TableRow key={run.id} data-testid={`grading-run-row-${run.id}`}>
                <TableCell className="font-mono text-sm font-medium">{run.runNumber}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{run.gradingProfileId.slice(0, 8)}…</TableCell>
                <TableCell>{fmtKg(run.inputWeightKg)}</TableCell>
                <TableCell>{fmtKg(run.totalOutputKg)}</TableCell>
                <TableCell>{fmtKg(run.lossKg)} <span className="text-muted-foreground text-xs">({fmtPct(run.lossPct)})</span></TableCell>
                <TableCell className="text-muted-foreground text-sm">{run.createdAt?.slice(0, 10)}</TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={() => setViewRunId(run.id)} data-testid={`btn-view-run-${run.id}`}>View</Button>
                </TableCell>
              </TableRow>
            )) : (
              <TableRow><TableCell colSpan={7} className="py-12 text-center text-muted-foreground">No grading runs yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      {dialogOpen && (
        <RunGradingDialog profiles={activeProfiles} onClose={() => setDialogOpen(false)} />
      )}
      {viewRunId && (
        <RunResultsDialog runId={viewRunId} onClose={() => setViewRunId(null)} />
      )}
    </Card>
  );
}

function RunGradingDialog({ profiles, onClose }: { profiles: GradingProfile[]; onClose: () => void }) {
  const { toast } = useToast();
  const [profileId, setProfileId] = useState<string>("");
  const [inputWeightKg, setInputWeightKg] = useState("");
  const [siloBatchId, setSiloBatchId] = useState("");
  const [notes, setNotes] = useState("");
  const [actuals, setActuals] = useState<Record<string, string>>({});

  const { data: detail } = useGetGradingProfile(profileId, {
    query: { enabled: !!profileId, queryKey: ["getGradingProfile", profileId] },
  });
  const create = useCreateGradingRun();

  const input = Number(inputWeightKg) || 0;
  const outputs = detail?.outputs ?? [];
  const totalActual = outputs.reduce((s, o) => s + (Number(actuals[o.id]) || 0), 0);
  const loss = Math.max(0, input - totalActual);
  const overInput = totalActual - input > 0.01;

  const canSubmit = !!profileId && input > 0 && outputs.length > 0 && !overInput &&
    outputs.every(o => actuals[o.id] !== undefined && actuals[o.id] !== "" && Number(actuals[o.id]) >= 0);

  const submit = () => {
    create.mutate(
      {
        data: {
          gradingProfileId: profileId,
          inputWeightKg: input,
          siloBatchId: siloBatchId.trim() || undefined,
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
            <div><Label>Input weight (kg)</Label><Input type="number" step="0.01" value={inputWeightKg} onChange={e => setInputWeightKg(e.target.value)} data-testid="input-grading-input-kg" /></div>
            <div><Label>Silo batch ID (optional)</Label><Input value={siloBatchId} onChange={e => setSiloBatchId(e.target.value)} placeholder="UUID" /></div>
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
