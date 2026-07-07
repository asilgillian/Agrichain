import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import {
  useGetProcurementWorkflow,
  useUpdateProcurementWorkflow,
  useAddWorkflowStage,
  useUpdateWorkflowStage,
  useDeleteWorkflowStage,
  useReorderWorkflowStages,
  type CreateWorkflowStageBodyStageKind,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

const STAGE_KINDS = [
  "WEIGHT_SUBMIT",
  "WEIGHT_APPROVE",
  "QC_SUBMIT",
  "QC_APPROVE",
  "PRICING_PROPOSE",
  "PRICING_APPROVE",
  "INFO_CHECKPOINT",
] as const;

export default function ProcurementWorkflowDetailPage() {
  const params = useParams<{ id: string }>();
  const workflowId = params.id;
  const { data, isLoading, refetch } = useGetProcurementWorkflow(workflowId);
  const wf = data as any;
  const updateMut = useUpdateProcurementWorkflow();
  const addStageMut = useAddWorkflowStage();
  const updateStageMut = useUpdateWorkflowStage();
  const deleteStageMut = useDeleteWorkflowStage();
  const reorderMut = useReorderWorkflowStages();
  const { toast } = useToast();

  // Local stages mirror so we can preview reorders before persisting.
  const [stages, setStages] = useState<any[]>([]);
  useEffect(() => {
    if (wf?.stages) setStages([...wf.stages].sort((a, b) => a.orderIdx - b.orderIdx));
  }, [wf?.stages]);

  const dirty = useMemo(() => {
    if (!wf?.stages) return false;
    const orig = [...wf.stages].sort((a, b) => a.orderIdx - b.orderIdx).map((s) => s.id).join(",");
    const next = stages.map((s) => s.id).join(",");
    return orig !== next;
  }, [wf?.stages, stages]);

  const persistOrder = async () => {
    try {
      await reorderMut.mutateAsync({
        workflowId,
        data: { stageIds: stages.map((s) => s.id) },
      });
      toast({ title: "Stage order saved" });
      void refetch();
    } catch (e: any) {
      toast({ title: "Reorder failed", description: String(e?.message ?? e), variant: "destructive" });
    }
  };

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= stages.length) return;
    const copy = [...stages];
    [copy[idx], copy[j]] = [copy[j]!, copy[idx]!];
    setStages(copy);
  };

  const toggleActive = async (stage: any) => {
    try {
      await updateStageMut.mutateAsync({
        workflowId,
        stageId: stage.id,
        data: { isActive: !stage.isActive },
      });
      void refetch();
    } catch (e: any) {
      toast({ title: "Update failed", description: String(e?.message ?? e), variant: "destructive" });
    }
  };

  const removeStage = async (stage: any) => {
    if (!confirm(`Remove stage "${stage.displayName}"?`)) return;
    try {
      await deleteStageMut.mutateAsync({ workflowId, stageId: stage.id });
      void refetch();
    } catch (e: any) {
      toast({ title: "Delete failed", description: String(e?.message ?? e), variant: "destructive" });
    }
  };

  const setDefault = async () => {
    try {
      await updateMut.mutateAsync({ workflowId, data: { isDefault: true } });
      toast({ title: "Set as default" });
      void refetch();
    } catch (e: any) {
      toast({ title: "Update failed", description: String(e?.message ?? e), variant: "destructive" });
    }
  };

  const toggleWfActive = async () => {
    try {
      await updateMut.mutateAsync({ workflowId, data: { isActive: !wf.isActive } });
      void refetch();
    } catch (e: any) {
      toast({ title: "Update failed", description: String(e?.message ?? e), variant: "destructive" });
    }
  };

  // Add stage dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newStage, setNewStage] = useState<{ stageKind: CreateWorkflowStageBodyStageKind; displayName: string; description: string }>({ stageKind: "INFO_CHECKPOINT", displayName: "", description: "" });
  const submitNewStage = async () => {
    if (!newStage.displayName.trim()) {
      toast({ title: "Display name required", variant: "destructive" });
      return;
    }
    try {
      await addStageMut.mutateAsync({
        workflowId,
        data: {
          stageKind: newStage.stageKind,
          displayName: newStage.displayName.trim(),
          description: newStage.description.trim() || undefined,
        },
      });
      toast({ title: "Stage added" });
      setAddOpen(false);
      setNewStage({ stageKind: "INFO_CHECKPOINT", displayName: "", description: "" });
      void refetch();
    } catch (e: any) {
      toast({ title: "Add failed", description: String(e?.message ?? e), variant: "destructive" });
    }
  };

  if (isLoading || !wf) {
    return (
      <div className="container mx-auto p-6 space-y-4">
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-procurement-workflow-detail">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/procurement/workflows">
            <Button variant="ghost" size="sm" data-testid="link-back-workflows"><ArrowLeft className="h-4 w-4 mr-2" /> Back</Button>
          </Link>
          <h1 className="text-2xl font-bold mt-2">{wf.name}</h1>
          <div className="text-sm text-muted-foreground font-mono">{wf.code}{wf.commodityType ? ` · ${wf.commodityType}` : ""}</div>
          {wf.description && <p className="text-sm text-muted-foreground mt-1">{wf.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {wf.isDefault ? (
            <Badge variant="default">Default</Badge>
          ) : (
            <Button variant="outline" size="sm" onClick={setDefault} data-testid="btn-set-default">Set as Default</Button>
          )}
          <Button variant="outline" size="sm" onClick={toggleWfActive} data-testid="btn-toggle-active">
            {wf.isActive ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Stages</CardTitle>
          <div className="flex gap-2">
            {dirty && (
              <Button size="sm" onClick={persistOrder} disabled={reorderMut.isPending} data-testid="btn-save-order">
                {reorderMut.isPending ? "Saving..." : "Save Order"}
              </Button>
            )}
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" data-testid="btn-add-stage"><Plus className="h-4 w-4 mr-2" />Add Stage</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Stage</DialogTitle>
                  <DialogDescription>New stages are appended to the end. Reorder with the arrows.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Stage Kind</Label>
                    <Select value={newStage.stageKind} onValueChange={(v) => setNewStage({ ...newStage, stageKind: v as CreateWorkflowStageBodyStageKind })}>
                      <SelectTrigger data-testid="select-stage-kind"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STAGE_KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Display Name</Label>
                    <Input data-testid="input-stage-name" value={newStage.displayName} onChange={(e) => setNewStage({ ...newStage, displayName: e.target.value })} />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea data-testid="input-stage-desc" value={newStage.description} onChange={(e) => setNewStage({ ...newStage, description: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                  <Button onClick={submitNewStage} disabled={addStageMut.isPending} data-testid="btn-submit-stage">Add</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {stages.length === 0 && <div className="text-sm text-muted-foreground">No stages yet. Add one to get started.</div>}
          {stages.map((s, idx) => (
            <div
              key={s.id}
              className={`flex items-center gap-2 rounded-md border p-3 ${s.isActive ? "" : "opacity-50"}`}
              data-testid={`row-stage-${s.stageKind}`}
            >
              <div className="flex flex-col gap-1">
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => move(idx, -1)} disabled={idx === 0} data-testid={`btn-up-${idx}`}>
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => move(idx, 1)} disabled={idx === stages.length - 1} data-testid={`btn-down-${idx}`}>
                  <ArrowDown className="h-3 w-3" />
                </Button>
              </div>
              <div className="text-xs text-muted-foreground w-6 text-center">{idx + 1}</div>
              <div className="flex-1">
                <div className="font-medium">{s.displayName}</div>
                <div className="text-xs text-muted-foreground font-mono">{s.stageKind}</div>
                {s.description && <div className="text-xs text-muted-foreground">{s.description}</div>}
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Active</Label>
                <Switch checked={s.isActive} onCheckedChange={() => toggleActive(s)} data-testid={`switch-active-${s.stageKind}`} />
                <Button variant="ghost" size="icon" onClick={() => removeStage(s)} data-testid={`btn-delete-${s.stageKind}`}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
