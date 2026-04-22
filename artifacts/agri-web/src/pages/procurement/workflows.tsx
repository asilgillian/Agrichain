import { useState } from "react";
import { Link } from "wouter";
import {
  useListProcurementWorkflows,
  useCreateProcurementWorkflow,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Workflow as WorkflowIcon } from "lucide-react";

export default function ProcurementWorkflowsPage() {
  const { data, isLoading, refetch } = useListProcurementWorkflows();
  const workflows = Array.isArray(data) ? data : [];
  const createMut = useCreateProcurementWorkflow();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", description: "", commodityType: "" });

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast({ title: "Code and name are required", variant: "destructive" });
      return;
    }
    try {
      await createMut.mutateAsync({
        data: {
          code: form.code.trim(),
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          commodityType: form.commodityType.trim() || undefined,
        },
      });
      toast({ title: "Workflow created" });
      setOpen(false);
      setForm({ code: "", name: "", description: "", commodityType: "" });
      void refetch();
    } catch (e: any) {
      toast({ title: "Create failed", description: String(e?.message ?? e), variant: "destructive" });
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-procurement-workflows">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <WorkflowIcon className="h-6 w-6" /> Procurement Workflows
          </h1>
          <p className="text-sm text-muted-foreground">Configure stage sequences. Deliveries pin a workflow at creation and progress through its active stages.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="btn-new-workflow"><Plus className="h-4 w-4 mr-2" /> New Workflow</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Procurement Workflow</DialogTitle>
              <DialogDescription>Create a workflow shell. You'll add and order stages on the next screen.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="wf-code">Code</Label>
                <Input id="wf-code" data-testid="input-wf-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="QUICK_PRICING" />
              </div>
              <div>
                <Label htmlFor="wf-name">Name</Label>
                <Input id="wf-name" data-testid="input-wf-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Quick Pricing Workflow" />
              </div>
              <div>
                <Label htmlFor="wf-commodity">Commodity (optional)</Label>
                <Input id="wf-commodity" data-testid="input-wf-commodity" value={form.commodityType} onChange={(e) => setForm({ ...form, commodityType: e.target.value })} placeholder="Leave blank for global" />
              </div>
              <div>
                <Label htmlFor="wf-desc">Description</Label>
                <Textarea id="wf-desc" data-testid="input-wf-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={createMut.isPending} data-testid="btn-submit-workflow">{createMut.isPending ? "Creating..." : "Create"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && <Skeleton className="h-48 w-full" />}
      {!isLoading && workflows.length === 0 && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No workflows yet. The default 6-stage flow will seed automatically on first use.</CardContent></Card>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {workflows.map((wf: any) => (
          <Link key={wf.id} href={`/procurement/workflows/${wf.id}`}>
            <Card className="cursor-pointer hover-elevate active-elevate-2" data-testid={`card-workflow-${wf.code}`}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{wf.name}</span>
                  <div className="flex gap-1">
                    {wf.isDefault && <Badge variant="default">Default</Badge>}
                    {!wf.isActive && <Badge variant="outline">Inactive</Badge>}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div className="text-xs font-mono text-muted-foreground">{wf.code}</div>
                {wf.commodityType && <div className="text-xs">Commodity: <span className="font-medium">{wf.commodityType}</span></div>}
                <div className="text-muted-foreground">{wf.stageCount ?? 0} stage{wf.stageCount === 1 ? "" : "s"}</div>
                {wf.description && <div className="text-xs text-muted-foreground line-clamp-2">{wf.description}</div>}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
