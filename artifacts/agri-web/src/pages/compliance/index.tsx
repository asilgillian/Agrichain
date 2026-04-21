import { useState } from "react";
import { useGetEudrCompliance, useListGapAssessments, useListTrainingSessions, useListUsers } from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldCheck, AlertTriangle, Plus } from "lucide-react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

const emptyTraining = { title: "", type: "GAP", scheduledDate: new Date().toISOString().slice(0, 10), location: "", facilitatorId: "" };

export default function CompliancePage() {
  const { data: eudr, isLoading: isLoadingEudr } = useGetEudrCompliance();
  const { data: gaps, isLoading: isLoadingGaps } = useListGapAssessments({});
  const { data: trainings, isLoading: isLoadingTrainings } = useListTrainingSessions();
  const { data: users } = useListUsers({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyTraining);
  const { toast } = useToast();
  const qc = useQueryClient();

  const createMut = useMutation({
    mutationFn: (body: any) => fetch(`${API_BASE}/api/compliance/training-sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/compliance/training-sessions"] });
      toast({ title: "Training session scheduled" });
      setOpen(false);
      setForm(emptyTraining);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Compliance Hub</h1>
        <p className="text-muted-foreground mt-1">EUDR status, GAP assessments, and training tracker</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <CardTitle>EUDR Compliance</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingEudr ? <Skeleton className="h-20 w-full" /> : eudr ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div><p className="text-xs text-muted-foreground">Compliant Farmers</p><p className="text-2xl font-bold text-green-600">{eudr.compliantFarmers}</p></div>
              <div><p className="text-xs text-muted-foreground">Total Enrolled</p><p className="text-2xl font-bold">{eudr.totalEnrolled}</p></div>
              <div><p className="text-xs text-muted-foreground">With GPS Polygon</p><p className="text-2xl font-bold">{eudr.farmersWithPolygon}</p></div>
              <div>
                <p className="text-xs text-muted-foreground">Compliance Rate</p>
                <p className={`text-2xl font-bold ${(eudr.complianceRate ?? 0) > 0.9 ? "text-green-600" : "text-amber-600"}`}>
                  {(((eudr.complianceRate ?? 0)) * 100).toFixed(1)}%
                </p>
              </div>
            </div>
          ) : null}
          {eudr && (eudr.expiringSoon ?? 0) > 0 && (
            <div className="mt-4 flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950 p-3 rounded-lg">
              <AlertTriangle className="h-4 w-4" />
              <span>{eudr.expiringSoon} certifications expiring within 30 days</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>GAP Assessments</CardTitle>
            <Badge variant="secondary">{isLoadingGaps ? "..." : (gaps?.length ?? 0)}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Farmer</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingGaps ? (
                <TableRow><TableCell colSpan={5}><Skeleton className="h-12 w-full" /></TableCell></TableRow>
              ) : gaps && gaps.length > 0 ? gaps.map(g => (
                <TableRow key={g.id} data-testid={`gap-row-${g.id}`}>
                  <TableCell className="font-medium">{(g as any).farmerName}</TableCell>
                  <TableCell className="text-muted-foreground">{(g as any).agentName}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${(g.overallScore / (g.maxScore || 100)) * 100}%` }} />
                      </div>
                      <span className="text-sm font-medium">{g.overallScore}/{g.maxScore}</span>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant={g.status === "approved" ? "default" : "secondary"}>{g.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-sm">{format(new Date(g.assessedAt), "MMM d, yyyy")}</TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No assessments found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Training Sessions</CardTitle>
            <div className="flex items-center gap-3">
              <Badge variant="secondary">{isLoadingTrainings ? "..." : (trainings?.length ?? 0)}</Badge>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-2" data-testid="new-training-btn"><Plus className="h-4 w-4" /> Schedule</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Schedule Training Session</DialogTitle>
                    <DialogDescription>Plan a farmer training session for GAP, EUDR, or other compliance topics.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div><Label>Title *</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. EUDR Compliance Briefing" data-testid="input-title" /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Type *</Label>
                        <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                          <SelectTrigger data-testid="input-type"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="GAP">GAP</SelectItem>
                            <SelectItem value="EUDR">EUDR</SelectItem>
                            <SelectItem value="Rainforest Alliance">Rainforest Alliance</SelectItem>
                            <SelectItem value="Post-harvest">Post-harvest</SelectItem>
                            <SelectItem value="Financial Literacy">Financial Literacy</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div><Label>Date *</Label><Input type="date" value={form.scheduledDate} onChange={e => setForm({ ...form, scheduledDate: e.target.value })} data-testid="input-date" /></div>
                    </div>
                    <div><Label>Location</Label><Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="e.g. Kibaale Coop Hall" data-testid="input-location" /></div>
                    <div>
                      <Label>Facilitator *</Label>
                      <Select value={form.facilitatorId} onValueChange={v => setForm({ ...form, facilitatorId: v })}>
                        <SelectTrigger data-testid="input-facilitator"><SelectValue placeholder="Select facilitator" /></SelectTrigger>
                        <SelectContent>
                          {users?.map(u => <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button onClick={() => {
                      const title = form.title.trim();
                      if (!title || !form.type || !form.scheduledDate || !form.facilitatorId) {
                        toast({ title: "Title, type, date and facilitator required", variant: "destructive" });
                        return;
                      }
                      const body: any = { title, type: form.type, scheduledDate: form.scheduledDate, facilitatorId: form.facilitatorId };
                      if (form.location.trim()) body.location = form.location.trim();
                      createMut.mutate(body);
                    }} disabled={createMut.isPending} data-testid="submit-training">{createMut.isPending ? "Saving..." : "Schedule"}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Attendees</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingTrainings ? (
                <TableRow><TableCell colSpan={6}><Skeleton className="h-12 w-full" /></TableCell></TableRow>
              ) : trainings && trainings.length > 0 ? trainings.map(t => (
                <TableRow key={t.id} data-testid={`training-row-${t.id}`}>
                  <TableCell className="font-medium">{t.title}</TableCell>
                  <TableCell className="capitalize">{t.type}</TableCell>
                  <TableCell className="text-muted-foreground">{format(new Date(t.scheduledDate), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-muted-foreground">{t.location ?? "—"}</TableCell>
                  <TableCell>{t.attendeeCount}</TableCell>
                  <TableCell><Badge variant={t.status === "completed" ? "default" : "secondary"}>{t.status}</Badge></TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No training sessions</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
