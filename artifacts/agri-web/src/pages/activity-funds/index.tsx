import { useState } from "react";
import { useListActivityFunds } from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Plus, Check, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_CURRENCY } from "@/lib/currency";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

function fmtUGX(v?: number | null) {
  if (v == null) return "-";
  return new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(Number(v));
}

const statusColors: Record<string, "default" | "secondary" | "destructive"> = {
  approved: "default", pending: "secondary", rejected: "destructive", disbursed: "default",
};

const emptyForm = { activityType: "field_visit", plannedDate: new Date().toISOString().slice(0, 10), destination: "", estimatedAmount: "", currency: DEFAULT_CURRENCY };

export default function ActivityFundsPage() {
  const { data: funds, isLoading } = useListActivityFunds({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [comment, setComment] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const createMut = useMutation({
    mutationFn: (body: any) => fetch(`${API_BASE}/api/activity-funds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/activity-funds"] });
      toast({ title: "Request submitted" });
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const reviewMut = useMutation({
    mutationFn: ({ id, decision, comment }: any) => fetch(`${API_BASE}/api/activity-funds/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, comment }) })
      .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/activity-funds"] });
      toast({ title: "Decision recorded" });
      setReviewId(null);
      setComment("");
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const submit = () => {
    const amt = Number(form.estimatedAmount);
    if (!form.activityType || !form.plannedDate || !Number.isFinite(amt) || amt <= 0) {
      toast({ title: "Activity, date and a positive amount are required", variant: "destructive" });
      return;
    }
    const body: any = {
      activityType: form.activityType,
      plannedDate: form.plannedDate,
      estimatedAmount: amt,
      currency: form.currency,
    };
    const dest = form.destination.trim();
    if (dest) body.destination = dest;
    createMut.mutate(body);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Activity Funds</h1>
          <p className="text-muted-foreground mt-1">Field agent activity fund requests and approvals</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{isLoading ? "..." : (funds?.length ?? 0)} requests</Badge>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" data-testid="new-fund-btn"><Plus className="h-4 w-4" /> New Request</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Activity Fund Request</DialogTitle>
                <DialogDescription>Submit a request for fuel, allowances, or operational costs.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Activity Type *</Label>
                  <Select value={form.activityType} onValueChange={v => setForm({ ...form, activityType: v })}>
                    <SelectTrigger data-testid="input-activity-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="field_visit">Field Visit</SelectItem>
                      <SelectItem value="training">Training</SelectItem>
                      <SelectItem value="bulking">Bulking / Collection</SelectItem>
                      <SelectItem value="distribution">Input Distribution</SelectItem>
                      <SelectItem value="fuel">Fuel</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Planned Date *</Label><Input type="date" value={form.plannedDate} onChange={e => setForm({ ...form, plannedDate: e.target.value })} data-testid="input-planned-date" /></div>
                  <div><Label>Estimated Amount (UGX) *</Label><Input type="number" value={form.estimatedAmount} onChange={e => setForm({ ...form, estimatedAmount: e.target.value })} placeholder="50000" data-testid="input-amount" /></div>
                </div>
                <div><Label>Destination</Label><Input value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} placeholder="e.g. Kibaale district" data-testid="input-destination" /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={submit} disabled={createMut.isPending} data-testid="submit-fund">{createMut.isPending ? "Saving..." : "Submit"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Activity Type</TableHead>
                <TableHead>Planned Date</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Estimated</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2].map(i => <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-10 w-full" /></TableCell></TableRow>)
              ) : funds && funds.length > 0 ? funds.map(f => (
                <TableRow key={f.id} data-testid={`fund-row-${f.id}`}>
                  <TableCell className="font-medium">{(f as any).agentName ?? "—"}</TableCell>
                  <TableCell className="capitalize">{(f.activityType ?? "").replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-muted-foreground">{format(new Date(f.plannedDate), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-muted-foreground">{f.destination ?? "—"}</TableCell>
                  <TableCell>{fmtUGX(f.estimatedAmount)}</TableCell>
                  <TableCell>{f.approvedAmount != null ? fmtUGX(Number(f.approvedAmount)) : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell><Badge variant={statusColors[f.status ?? ""] ?? "secondary"}>{f.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    {f.status === "pending" ? (
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => { setReviewId(f.id); setDecision("approved"); }} data-testid={`approve-${f.id}`}><Check className="h-4 w-4 text-green-600" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => { setReviewId(f.id); setDecision("rejected"); }} data-testid={`reject-${f.id}`}><X className="h-4 w-4 text-red-600" /></Button>
                      </div>
                    ) : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={8} className="py-12 text-center text-muted-foreground">No fund requests</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!reviewId} onOpenChange={(o) => !o && setReviewId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision === "approved" ? "Approve" : "Reject"} Request</DialogTitle>
            <DialogDescription>Provide a comment to record your decision.</DialogDescription>
          </DialogHeader>
          <div><Label>Comment *</Label><Textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} data-testid="input-comment" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewId(null)}>Cancel</Button>
            <Button onClick={() => { if (!comment) { toast({ title: "Comment required", variant: "destructive" }); return; } reviewMut.mutate({ id: reviewId, decision, comment }); }} disabled={reviewMut.isPending} data-testid="submit-review">{reviewMut.isPending ? "Saving..." : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
