import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Cog, Plus, Trash2 } from "lucide-react";
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

type Process = {
  id: string; name: string; code: string; description: string | null;
  allowedStages: string[] | null;
  defaultExpectedRate: string | null;
  defaultMinRate: string | null;
  defaultMaxRate: string | null;
  status: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return customFetch<T>(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

export default function ProcessesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: processes, isLoading } = useQuery<Process[]>({
    queryKey: ["/api/processes"],
    queryFn: () => api("/api/processes"),
  });

  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Process | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/processes/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/processes"] }),
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const toggleStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(`/api/processes/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/processes"] }),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Cog className="h-7 w-7 text-blue-600" /> Process Master
          </h1>
          <p className="text-muted-foreground">Transformation operations (Pulping, Drying, Hulling…) — controls which processes appear in commodity conversions and at which operational stages they're permitted.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="btn-new-process"><Plus className="h-4 w-4 mr-1" /> New Process</Button>
          </DialogTrigger>
          <ProcessDialog
            onClose={() => setOpen(false)}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: ["/api/processes"] });
              setOpen(false);
              toast({ title: "Process created" });
            }}
            onError={(m) => toast({ title: "Failed", description: m, variant: "destructive" })}
          />
        </Dialog>
      </div>

      {isLoading ? <Skeleton className="h-64" /> : (
        <Card>
          <CardHeader><CardTitle>Processes</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Allowed Stages</TableHead>
                <TableHead>Default Rate (Exp / Min–Max)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow></TableHeader>
              <TableBody>
                {(processes ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No processes yet — add one to enable it in the Conversions tab of varieties.
                  </TableCell></TableRow>
                )}
                {(processes ?? []).map(p => (
                  <TableRow key={p.id} data-testid={`row-process-${p.code}`}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell><span className="text-muted-foreground text-xs">{p.code}</span></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(!p.allowedStages || p.allowedStages.length === 0)
                          ? <Badge variant="secondary" className="text-xs">Any stage</Badge>
                          : p.allowedStages.map(s => <Badge key={s} variant="outline" className="text-xs">{stageLabel(s)}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.defaultExpectedRate
                        ? <>
                            {Number(p.defaultExpectedRate)}
                            {(p.defaultMinRate || p.defaultMaxRate) && (
                              <span className="text-muted-foreground"> ({p.defaultMinRate ? Number(p.defaultMinRate) : "—"}–{p.defaultMaxRate ? Number(p.defaultMaxRate) : "—"})</span>
                            )}
                          </>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell><Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEdit(p)} data-testid={`btn-edit-process-${p.code}`}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => toggleStatus.mutate({ id: p.id, status: p.status === "active" ? "inactive" : "active" })}>
                        {p.status === "active" ? "Deactivate" : "Activate"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove.mutate(p.id)} data-testid={`btn-delete-process-${p.code}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <ProcessDialog
            existing={edit}
            onClose={() => setEdit(null)}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: ["/api/processes"] });
              setEdit(null);
              toast({ title: "Process updated" });
            }}
            onError={(m) => toast({ title: "Failed", description: m, variant: "destructive" })}
          />
        </Dialog>
      )}
    </div>
  );
}

function ProcessDialog({
  existing, onClose, onSaved, onError,
}: {
  existing?: Process;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState({
    name: existing?.name ?? "",
    code: existing?.code ?? "",
    description: existing?.description ?? "",
    allowedStages: existing?.allowedStages ?? [] as string[],
    defaultExpectedRate: existing?.defaultExpectedRate ?? "",
    defaultMinRate: existing?.defaultMinRate ?? "",
    defaultMaxRate: existing?.defaultMaxRate ?? "",
  });
  const toggleStage = (v: string) =>
    setForm(f => ({ ...f, allowedStages: f.allowedStages.includes(v) ? f.allowedStages.filter(x => x !== v) : [...f.allowedStages, v] }));

  const save = useMutation({
    mutationFn: (b: any) => existing
      ? api(`/api/processes/${existing.id}`, { method: "PATCH", body: JSON.stringify(b) })
      : api("/api/processes", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => onSaved(),
    onError: (e: any) => onError(e.message),
  });

  const submit = () => {
    save.mutate({
      name: form.name,
      ...(existing ? {} : { code: form.code }),
      description: form.description || null,
      allowedStages: form.allowedStages,
      defaultExpectedRate: form.defaultExpectedRate === "" ? null : Number(form.defaultExpectedRate),
      defaultMinRate: form.defaultMinRate === "" ? null : Number(form.defaultMinRate),
      defaultMaxRate: form.defaultMaxRate === "" ? null : Number(form.defaultMaxRate),
    });
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>{existing ? "Edit Process" : "New Process"}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Pulping" data-testid="input-process-name" /></div>
          <div><Label>Code {existing && <span className="text-xs text-muted-foreground">(read-only)</span>}</Label>
            <Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="pulping" disabled={!!existing} data-testid="input-process-code" /></div>
        </div>
        <div><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Optional" /></div>
        <div>
          <Label>Allowed Stages <span className="text-xs text-muted-foreground">(none selected = any stage)</span></Label>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {STAGE_OPTIONS.map(s => (
              <label key={s.value} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.allowedStages.includes(s.value)} onChange={() => toggleStage(s.value)} data-testid={`chk-stage-${s.value}`} />
                {s.label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <Label>Default Conversion Rates <span className="text-xs text-muted-foreground">(output kg per 1 kg input — pre-fills new conversions)</span></Label>
          <div className="grid grid-cols-3 gap-3 mt-1">
            <div><Label className="text-xs">Expected</Label><Input type="number" step="0.0001" value={form.defaultExpectedRate} onChange={e => setForm({ ...form, defaultExpectedRate: e.target.value })} placeholder="0.45" /></div>
            <div><Label className="text-xs">Min</Label><Input type="number" step="0.0001" value={form.defaultMinRate} onChange={e => setForm({ ...form, defaultMinRate: e.target.value })} placeholder="0.40" /></div>
            <div><Label className="text-xs">Max</Label><Input type="number" step="0.0001" value={form.defaultMaxRate} onChange={e => setForm({ ...form, defaultMaxRate: e.target.value })} placeholder="0.50" /></div>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!form.name || (!existing && !form.code) || save.isPending} data-testid="btn-save-process">
          {save.isPending ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
