import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Users, MapPin, Download, Archive, Shield, ArrowRightLeft, UserPlus, Pencil } from "lucide-react";
import { useListRegions } from "@workspace/api-client-react";
import { X } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type Leader = { id: string; farmerId: string; position: string; termStart: string; termEnd: string | null; status: string; farmerFirstName?: string; farmerLastName?: string; farmerRef?: string };
type Member = { id: string; referenceNumber: string; firstName: string; lastName: string; village: string | null; status: string };
type Transfer = { id: string; farmerId: string; fromGroupId: string | null; toGroupId: string; reason: string; kind: string; transferredAt: string; actorName: string | null };
type Group = {
  id: string; name: string; regionId: string; village: string | null; parish: string | null; subCounty: string | null; district: string | null;
  groupType: string; status: string; parentGroupId: string | null;
  parent: Group | null; children: Group[];
  districts: { id: string; name: string }[];
  memberCount: number; activePlots: number; procurementVolumeKg: number; complianceScore: number;
  members: Member[]; leaders: Leader[]; transfers: Transfer[];
};

export default function GroupDetail() {
  const [, params] = useRoute("/groups/:id");
  const groupId = params?.id ?? "";
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: group, isLoading } = useQuery<Group>({
    queryKey: [`/api/groups/${groupId}`],
    queryFn: () => fetch(`${API_BASE}/api/groups/${groupId}`).then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); }),
    enabled: !!groupId,
  });
  const { data: allGroups } = useQuery<Group[]>({
    queryKey: ["/api/groups?status=active"],
    queryFn: () => fetch(`${API_BASE}/api/groups?status=active`).then(r => r.json()),
  });

  const [leaderOpen, setLeaderOpen] = useState(false);
  const [leaderForm, setLeaderForm] = useState({ farmerId: "", position: "", termStart: new Date().toISOString().slice(0, 10), termEnd: "" });
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState<{ toGroupId: string; reason: string; selected: Set<string> }>({ toGroupId: "", reason: "", selected: new Set() });
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveForm, setArchiveForm] = useState({ redistributeToGroupId: "", reason: "" });
  const [anchorOpen, setAnchorOpen] = useState(false);
  const [districtIds, setDistrictIds] = useState<string[]>([]);
  const [districtFilter, setDistrictFilter] = useState("");
  const { data: allRegions } = useListRegions();
  const allDistricts = (allRegions ?? []).filter((r: any) => r.level === 1 && (r.countryCode ?? "UG") === "UG")
    .sort((a: any, b: any) => a.name.localeCompare(b.name));

  const refetch = () => qc.invalidateQueries({ queryKey: [`/api/groups/${groupId}`] });
  const handleError = (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" });

  const addLeader = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/api/groups/${groupId}/leaders`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...leaderForm, termEnd: leaderForm.termEnd || undefined }),
      });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? "Failed"); return j;
    },
    onSuccess: () => { refetch(); setLeaderOpen(false); setLeaderForm({ farmerId: "", position: "", termStart: new Date().toISOString().slice(0, 10), termEnd: "" }); toast({ title: "Leader appointed" }); },
    onError: handleError,
  });

  const endLeader = useMutation({
    mutationFn: async (leaderId: string) => {
      const r = await fetch(`${API_BASE}/api/groups/${groupId}/leaders/${leaderId}/end`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? "Failed"); return j;
    },
    onSuccess: () => { refetch(); toast({ title: "Term ended" }); },
    onError: handleError,
  });

  const transfer = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/api/groups/${transferForm.toGroupId}/transfer`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ farmerIds: Array.from(transferForm.selected), reason: transferForm.reason }),
      });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? "Failed"); return j;
    },
    onSuccess: (j) => { refetch(); setTransferOpen(false); setTransferForm({ toGroupId: "", reason: "", selected: new Set() }); toast({ title: `Transferred ${j.movedCount} farmer(s)` }); },
    onError: handleError,
  });

  const editAnchor = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/api/groups/${groupId}/districts`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ districtIds }),
      });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? "Failed"); return j;
    },
    onSuccess: () => { refetch(); setAnchorOpen(false); toast({ title: "Districts updated" }); },
    onError: handleError,
  });

  const archive = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/api/groups/${groupId}/archive`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redistributeToGroupId: archiveForm.redistributeToGroupId || undefined,
          reason: archiveForm.reason || "archive",
        }),
      });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? "Failed"); return j;
    },
    onSuccess: (j) => { refetch(); setArchiveOpen(false); toast({ title: "Group archived", description: j.redistributedCount > 0 ? `${j.redistributedCount} members redistributed` : undefined }); },
    onError: handleError,
  });

  if (isLoading) return <div className="space-y-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  if (!group) return <div className="py-16 text-center text-muted-foreground">Group not found</div>;

  const activeLeaders = group.leaders.filter(l => l.status === "active");
  const otherGroups = (allGroups ?? []).filter(g => g.id !== group.id);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/groups"><ArrowLeft className="h-5 w-5 text-muted-foreground cursor-pointer hover:text-foreground" /></Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight" data-testid="group-name">{group.name}</h1>
              <Badge variant={group.status === "archived" ? "destructive" : "secondary"} data-testid="group-status">{group.status}</Badge>
              <Badge variant="outline">{group.groupType.replace(/_/g, " ")}</Badge>
            </div>
            <div className="text-muted-foreground mt-1 text-sm">
              <div className="flex items-start gap-1 flex-wrap" data-testid="group-districts">
                <MapPin className="h-3 w-3 mt-1 shrink-0" />
                {group.districts.length > 0 ? group.districts.map(d => (
                  <Badge key={d.id} variant="outline" data-testid={`district-chip-${d.id}`}>{d.name}</Badge>
                )) : <span>No districts assigned</span>}
                {group.status === "active" && (
                  <button
                    type="button"
                    className="ml-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    onClick={() => { setDistrictIds(group.districts.map(d => d.id)); setDistrictFilter(""); setAnchorOpen(true); }}
                    data-testid="edit-districts-btn"
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                )}
              </div>
              {group.village && <p className="mt-1">Village: {group.village}</p>}
            </div>
            {group.parent && (
              <p className="text-xs text-muted-foreground mt-1">Part of{" "}
                <Link href={`/groups/${group.parent.id}`} className="text-primary hover:underline">{group.parent.name}</Link>
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { window.open(`${API_BASE}/api/groups/${groupId}/report`, "_blank"); }} data-testid="download-report-btn"><Download className="h-4 w-4 mr-1" /> Report</Button>
          {group.status === "active" && (
            <Button variant="outline" size="sm" className="text-destructive" onClick={() => setArchiveOpen(true)} data-testid="archive-btn"><Archive className="h-4 w-4 mr-1" /> Archive</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Members</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold flex items-center gap-2" data-testid="kpi-members"><Users className="h-5 w-5 text-muted-foreground" />{group.memberCount}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Active Plots</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold" data-testid="kpi-plots">{group.activePlots}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Procurement (kg)</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold" data-testid="kpi-volume">{Math.round(group.procurementVolumeKg).toLocaleString()}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Compliance</CardTitle></CardHeader><CardContent><div className={`text-2xl font-bold ${group.complianceScore >= 0.8 ? "text-green-600" : "text-amber-600"}`} data-testid="kpi-compliance">{(group.complianceScore * 100).toFixed(0)}%</div></CardContent></Card>
      </div>

      {/* LEADERSHIP */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" /> Leadership</CardTitle>
          {group.status === "active" && <Button size="sm" variant="outline" onClick={() => setLeaderOpen(true)} data-testid="add-leader-btn"><UserPlus className="h-4 w-4 mr-1" /> Appoint</Button>}
        </CardHeader>
        <CardContent>
          {activeLeaders.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Position</TableHead><TableHead>Name</TableHead><TableHead>Term Start</TableHead><TableHead>Term End</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {activeLeaders.map(l => (
                  <TableRow key={l.id} data-testid={`leader-row-${l.position}`}>
                    <TableCell className="capitalize font-medium">{l.position.replace(/_/g, " ")}</TableCell>
                    <TableCell><Link href={`/farmers/${l.farmerId}`} className="text-primary hover:underline">{l.farmerFirstName} {l.farmerLastName}</Link><span className="ml-2 text-xs font-mono text-muted-foreground">{l.farmerRef}</span></TableCell>
                    <TableCell>{l.termStart}</TableCell>
                    <TableCell>{l.termEnd ?? "—"}</TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => endLeader.mutate(l.id)} data-testid={`end-leader-${l.id}`}>End term</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <div className="py-6 text-center text-muted-foreground text-sm">No active leaders</div>}
        </CardContent>
      </Card>

      {/* MEMBERS + TRANSFER */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Members</CardTitle>
          {group.status === "active" && transferForm.selected.size > 0 && (
            <Button size="sm" onClick={() => setTransferOpen(true)} data-testid="transfer-selected-btn"><ArrowRightLeft className="h-4 w-4 mr-1" /> Transfer {transferForm.selected.size}</Button>
          )}
        </CardHeader>
        <CardContent>
          {group.members.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead className="w-10" /><TableHead>Ref #</TableHead><TableHead>Name</TableHead><TableHead>Village</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {group.members.map(m => {
                  const checked = transferForm.selected.has(m.id);
                  return (
                    <TableRow key={m.id} data-testid={`member-row-${m.id}`}>
                      <TableCell>
                        <Checkbox checked={checked} onCheckedChange={(v) => {
                          const next = new Set(transferForm.selected);
                          if (v) next.add(m.id); else next.delete(m.id);
                          setTransferForm({ ...transferForm, selected: next });
                        }} data-testid={`member-check-${m.id}`} />
                      </TableCell>
                      <TableCell className="font-mono text-sm">{m.referenceNumber}</TableCell>
                      <TableCell><Link href={`/farmers/${m.id}`} className="text-primary hover:underline">{m.firstName} {m.lastName}</Link></TableCell>
                      <TableCell className="text-muted-foreground">{m.village ?? "-"}</TableCell>
                      <TableCell><Badge variant={m.status === "active" ? "default" : "secondary"}>{m.status}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : <div className="py-6 text-center text-muted-foreground text-sm">No members</div>}
        </CardContent>
      </Card>

      {/* TRANSFER HISTORY */}
      {group.transfers.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Transfer History</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Farmer</TableHead><TableHead>Direction</TableHead><TableHead>Reason</TableHead><TableHead>By</TableHead></TableRow></TableHeader>
              <TableBody>
                {group.transfers.map(t => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs">{new Date(t.transferredAt).toLocaleDateString()}</TableCell>
                    <TableCell className="font-mono text-xs">{t.farmerId.slice(0, 8)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{t.toGroupId === groupId ? "in" : "out"}</Badge></TableCell>
                    <TableCell className="text-xs">{t.reason}</TableCell>
                    <TableCell className="text-xs">{t.actorName ?? "system"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* APPOINT LEADER DIALOG */}
      <Dialog open={leaderOpen} onOpenChange={setLeaderOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Appoint Leader</DialogTitle><DialogDescription>Any existing active leader for the same position will be ended automatically.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Farmer *</Label>
              <Select value={leaderForm.farmerId} onValueChange={v => setLeaderForm({ ...leaderForm, farmerId: v })}>
                <SelectTrigger data-testid="leader-farmer"><SelectValue placeholder="Select member" /></SelectTrigger>
                <SelectContent>{group.members.map(m => <SelectItem key={m.id} value={m.id}>{m.firstName} {m.lastName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Position *</Label>
              <Select value={leaderForm.position} onValueChange={v => setLeaderForm({ ...leaderForm, position: v })}>
                <SelectTrigger data-testid="leader-position"><SelectValue placeholder="Select position" /></SelectTrigger>
                <SelectContent>
                  {["chairperson", "secretary", "treasurer", "extension_lead", "gender_lead"].map(p => <SelectItem key={p} value={p}>{p.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Term start *</Label><Input type="date" value={leaderForm.termStart} onChange={e => setLeaderForm({ ...leaderForm, termStart: e.target.value })} data-testid="leader-start" /></div>
              <div><Label>Term end</Label><Input type="date" value={leaderForm.termEnd} onChange={e => setLeaderForm({ ...leaderForm, termEnd: e.target.value })} data-testid="leader-end" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaderOpen(false)}>Cancel</Button>
            <Button onClick={() => addLeader.mutate()} disabled={!leaderForm.farmerId || !leaderForm.position || !leaderForm.termStart || addLeader.isPending} data-testid="submit-leader">{addLeader.isPending ? "Saving..." : "Appoint"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TRANSFER DIALOG */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transfer {transferForm.selected.size} farmer(s)</DialogTitle><DialogDescription>Reason is recorded on the audit trail.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Target group *</Label>
              <Select value={transferForm.toGroupId} onValueChange={v => setTransferForm({ ...transferForm, toGroupId: v })}>
                <SelectTrigger data-testid="transfer-target"><SelectValue placeholder="Select group" /></SelectTrigger>
                <SelectContent>{otherGroups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Reason *</Label><Input value={transferForm.reason} onChange={e => setTransferForm({ ...transferForm, reason: e.target.value })} placeholder="e.g. relocated to new parish" data-testid="transfer-reason" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>Cancel</Button>
            <Button onClick={() => transfer.mutate()} disabled={!transferForm.toGroupId || !transferForm.reason || transfer.isPending} data-testid="submit-transfer">{transfer.isPending ? "Transferring..." : "Transfer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EDIT DISTRICTS DIALOG */}
      <Dialog open={anchorOpen} onOpenChange={setAnchorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit districts covered</DialogTitle>
            <DialogDescription>A group can span multiple districts. Tick every district where its members live. Districts with member farmers cannot be removed.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {districtIds.length > 0 && (
              <div className="flex flex-wrap gap-1" data-testid="edit-selected-districts">
                {districtIds.map(id => {
                  const d = allDistricts.find((x: any) => x.id === id);
                  return (
                    <Badge key={id} variant="secondary" className="gap-1">
                      {d?.name ?? id.slice(0, 6)}
                      <button
                        type="button"
                        onClick={() => setDistrictIds(prev => prev.filter(x => x !== id))}
                        data-testid={`edit-remove-district-${id}`}
                        className="hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}
            <Input
              placeholder="Search districts..."
              value={districtFilter}
              onChange={e => setDistrictFilter(e.target.value)}
              data-testid="edit-district-search"
            />
            <div className="max-h-64 overflow-y-auto border rounded-md p-2 space-y-1">
              {allDistricts
                .filter((d: any) => !districtFilter.trim() || d.name.toLowerCase().includes(districtFilter.trim().toLowerCase()))
                .map((d: any) => (
                  <label key={d.id} className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded cursor-pointer" data-testid={`edit-district-row-${d.id}`}>
                    <Checkbox
                      checked={districtIds.includes(d.id)}
                      onCheckedChange={(v) => {
                        setDistrictIds(prev => v ? (prev.includes(d.id) ? prev : [...prev, d.id]) : prev.filter(x => x !== d.id));
                      }}
                    />
                    <span className="text-sm">{d.name}</span>
                  </label>
                ))}
            </div>
            <p className="text-xs text-muted-foreground">{districtIds.length} district{districtIds.length === 1 ? "" : "s"} selected</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnchorOpen(false)}>Cancel</Button>
            <Button
              onClick={() => editAnchor.mutate()}
              disabled={districtIds.length === 0 || editAnchor.isPending}
              data-testid="submit-edit-districts"
            >
              {editAnchor.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ARCHIVE DIALOG */}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive this group?</DialogTitle>
            <DialogDescription>
              {group.memberCount > 0
                ? `This group has ${group.memberCount} member(s). You must redistribute them to another active group.`
                : "No members to redistribute."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {group.memberCount > 0 && (
              <div>
                <Label>Redistribute members to *</Label>
                <Select value={archiveForm.redistributeToGroupId} onValueChange={v => setArchiveForm({ ...archiveForm, redistributeToGroupId: v })}>
                  <SelectTrigger data-testid="archive-target"><SelectValue placeholder="Select active group" /></SelectTrigger>
                  <SelectContent>{otherGroups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div><Label>Reason</Label><Input value={archiveForm.reason} onChange={e => setArchiveForm({ ...archiveForm, reason: e.target.value })} placeholder="e.g. merged with larger cooperative" data-testid="archive-reason" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => archive.mutate()} disabled={(group.memberCount > 0 && !archiveForm.redistributeToGroupId) || archive.isPending} data-testid="submit-archive">{archive.isPending ? "Archiving..." : "Archive"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
