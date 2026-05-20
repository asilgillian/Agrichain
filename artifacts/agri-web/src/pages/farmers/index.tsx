import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, UserPlus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_PHONE_CODE } from "@/lib/currency";
import { usePermissions } from "@/hooks/use-permissions";
import { OrgRegionGroupVillagePicker } from "@/components/OrgRegionGroupVillagePicker";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

const emptyFullForm = {
  firstName: "",
  lastName: "",
  nationalId: "",
  phoneNumber: DEFAULT_PHONE_CODE,
  sex: "male",
  village: "",
  orgRegionId: "",
  groupId: "",
  regionId: "",
};

const emptyPreForm = {
  firstName: "",
  lastName: "",
  phoneNumber: DEFAULT_PHONE_CODE,
  village: "",
  orgRegionId: "",
  groupId: "",
  regionId: "",
  sex: "",
};

// Type for the farmer rows including the new registrationStage field. The codegen'd
// useListFarmers type doesn't yet include this column, so we use a permissive query
// here and type the rows ourselves.
type FarmerRow = {
  id: string;
  firstName: string;
  lastName: string;
  referenceNumber: string;
  groupName: string | null;
  phoneNumber: string | null;
  village: string | null;
  status: string;
  photoUrl: string | null;
  registrationStage: "pre_registered" | "fully_registered";
};
type FarmersResponse = { data: FarmerRow[]; total: number; page: number; limit: number };

export default function FarmersList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<"all" | "pre_registered" | "fully_registered">("all");
  const [openFull, setOpenFull] = useState(false);
  const [openPre, setOpenPre] = useState(false);
  const [fullForm, setFullForm] = useState(emptyFullForm);
  const [preForm, setPreForm] = useState(emptyPreForm);
  const { toast } = useToast();
  const qc = useQueryClient();
  const limit = 20;
  const { has, isLoading: permsLoading } = usePermissions();
  const canFull = has("farmers.register");
  const canPre = has("farmers.preregister");

  // Hand-rolled query so we can pass the registrationStage filter (not in codegen'd schema yet).
  const queryString = (() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", String(limit));
    if (search) p.set("search", search);
    if (stageFilter !== "all") p.set("registrationStage", stageFilter);
    return p.toString();
  })();
  const { data, isLoading } = useQuery<FarmersResponse>({
    queryKey: ["/api/farmers", queryString],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/farmers?${queryString}`);
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`Failed to load farmers (${r.status}): ${text.slice(0, 200)}`);
      }
      return r.json();
    },
  });

  const createFullMut = useMutation({
    mutationFn: (body: any) =>
      fetch(`${API_BASE}/api/farmers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/farmers"] });
      toast({ title: "Farmer fully registered" });
      setOpenFull(false);
      setFullForm(emptyFullForm);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const createPreMut = useMutation({
    mutationFn: (body: any) =>
      fetch(`${API_BASE}/api/farmers/preregister`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/farmers"] });
      toast({ title: "Farmer pre-registered", description: "Complete full registration when KYC details are available." });
      setOpenPre(false);
      setPreForm(emptyPreForm);
    },
    onError: (e: any) => toast({ title: "Pre-registration failed", description: e.message, variant: "destructive" }),
  });

  const submitFull = () => {
    if (!fullForm.firstName.trim() || !fullForm.lastName.trim() || !fullForm.nationalId.trim() || !fullForm.orgRegionId || !fullForm.groupId || !fullForm.regionId) {
      toast({ title: "Missing fields", description: "Name, ID, region, group and village are required", variant: "destructive" });
      return;
    }
    const body: any = {
      firstName: fullForm.firstName.trim(),
      lastName: fullForm.lastName.trim(),
      nationalId: fullForm.nationalId.trim(),
      sex: fullForm.sex,
      orgRegionId: fullForm.orgRegionId,
      groupId: fullForm.groupId,
      regionId: fullForm.regionId,
    };
    const phone = fullForm.phoneNumber.trim();
    if (phone && phone !== DEFAULT_PHONE_CODE) body.phoneNumber = phone;
    if (fullForm.village.trim()) body.village = fullForm.village.trim();
    createFullMut.mutate(body);
  };

  const submitPre = () => {
    if (!preForm.firstName.trim() || !preForm.lastName.trim() || !preForm.orgRegionId || !preForm.groupId || !preForm.regionId) {
      toast({ title: "Missing fields", description: "Name, region, group and village are required", variant: "destructive" });
      return;
    }
    const body: any = {
      firstName: preForm.firstName.trim(),
      lastName: preForm.lastName.trim(),
      orgRegionId: preForm.orgRegionId,
      groupId: preForm.groupId,
      regionId: preForm.regionId,
    };
    const phone = preForm.phoneNumber.trim();
    if (phone && phone !== DEFAULT_PHONE_CODE) body.phoneNumber = phone;
    if (preForm.village.trim()) body.village = preForm.village.trim();
    if (preForm.sex) body.sex = preForm.sex;
    createPreMut.mutate(body);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Farmer Registry</h1>
          <p className="text-muted-foreground mt-1">Manage and monitor registered farmers.</p>
        </div>
        <div className="flex gap-2">
          {/* Pre-register: lighter capture for field agents */}
          {(canPre || permsLoading) && (
            <Dialog open={openPre} onOpenChange={setOpenPre}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2" disabled={!canPre} data-testid="preregister-farmer-btn"><UserPlus className="h-4 w-4" /> Pre-register</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Pre-register Farmer</DialogTitle>
                  <DialogDescription>Capture the bare minimum now. KYC details (national ID, etc.) can be completed later.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>First Name *</Label><Input value={preForm.firstName} onChange={e => setPreForm({ ...preForm, firstName: e.target.value })} data-testid="pre-input-first-name" /></div>
                    <div><Label>Last Name *</Label><Input value={preForm.lastName} onChange={e => setPreForm({ ...preForm, lastName: e.target.value })} data-testid="pre-input-last-name" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Phone</Label><Input value={preForm.phoneNumber} onChange={e => setPreForm({ ...preForm, phoneNumber: e.target.value })} placeholder="+256..." data-testid="pre-input-phone" /></div>
                    <div><Label>Village</Label><Input value={preForm.village} onChange={e => setPreForm({ ...preForm, village: e.target.value })} data-testid="pre-input-village" /></div>
                  </div>
                  <OrgRegionGroupVillagePicker
                    orgRegionId={preForm.orgRegionId}
                    groupId={preForm.groupId}
                    villageId={preForm.regionId}
                    onChange={({ orgRegionId, groupId, villageId }) =>
                      setPreForm({ ...preForm, orgRegionId, groupId, regionId: villageId })}
                    testIdPrefix="pre-input"
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpenPre(false)}>Cancel</Button>
                  <Button onClick={submitPre} disabled={createPreMut.isPending} data-testid="submit-preregister">{createPreMut.isPending ? "Saving..." : "Pre-register"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {/* Full registration: requires national ID, full KYC */}
          {(canFull || permsLoading) && (
            <Dialog open={openFull} onOpenChange={setOpenFull}>
              <DialogTrigger asChild>
                <Button className="gap-2" disabled={!canFull} data-testid="add-farmer-btn"><Plus className="h-4 w-4" /> Register Full</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Register New Farmer (Full)</DialogTitle>
                  <DialogDescription>Enter the farmer's details. National ID and group are required.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>First Name *</Label><Input value={fullForm.firstName} onChange={e => setFullForm({ ...fullForm, firstName: e.target.value })} data-testid="input-first-name" /></div>
                    <div><Label>Last Name *</Label><Input value={fullForm.lastName} onChange={e => setFullForm({ ...fullForm, lastName: e.target.value })} data-testid="input-last-name" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>National ID *</Label><Input value={fullForm.nationalId} onChange={e => setFullForm({ ...fullForm, nationalId: e.target.value })} data-testid="input-national-id" /></div>
                    <div><Label>Phone</Label><Input value={fullForm.phoneNumber} onChange={e => setFullForm({ ...fullForm, phoneNumber: e.target.value })} placeholder="+256..." data-testid="input-phone" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Sex</Label>
                      <Select value={fullForm.sex} onValueChange={v => setFullForm({ ...fullForm, sex: v })}>
                        <SelectTrigger data-testid="input-sex"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>Village</Label><Input value={fullForm.village} onChange={e => setFullForm({ ...fullForm, village: e.target.value })} data-testid="input-village" /></div>
                  </div>
                  <OrgRegionGroupVillagePicker
                    orgRegionId={fullForm.orgRegionId}
                    groupId={fullForm.groupId}
                    villageId={fullForm.regionId}
                    onChange={({ orgRegionId, groupId, villageId }) =>
                      setFullForm({ ...fullForm, orgRegionId, groupId, regionId: villageId })}
                    testIdPrefix="input"
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpenFull(false)}>Cancel</Button>
                  <Button onClick={submitFull} disabled={createFullMut.isPending} data-testid="submit-farmer">{createFullMut.isPending ? "Saving..." : "Register"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <Card>
        <div className="p-4 border-b flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between bg-muted/20">
          <div className="relative w-full sm:max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by name, ID, or phone..."
              className="pl-8 bg-background"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              data-testid="search-farmers"
            />
          </div>
          <Select value={stageFilter} onValueChange={(v: any) => { setStageFilter(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-[220px] bg-background" data-testid="stage-filter">
              <SelectValue placeholder="All stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All registration stages</SelectItem>
              <SelectItem value="pre_registered">Pre-registered only</SelectItem>
              <SelectItem value="fully_registered">Fully registered only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Farmer</TableHead>
                <TableHead>Ref Number</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-10 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : !data || data.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No farmers found.</TableCell>
                </TableRow>
              ) : (
                data.data.map((farmer) => (
                  <TableRow key={farmer.id} className="hover:bg-muted/50 cursor-pointer" data-testid={`farmer-row-${farmer.id}`}>
                    <TableCell>
                      <Link href={`/farmers/${farmer.id}`} className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={farmer.photoUrl ?? undefined} alt={`${farmer.firstName} ${farmer.lastName}`} />
                          <AvatarFallback>{farmer.firstName[0]}{farmer.lastName[0]}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="font-medium">{farmer.firstName} {farmer.lastName}</span>
                          <span className="text-xs text-muted-foreground">{farmer.village || "Unknown Village"}</span>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{farmer.referenceNumber}</TableCell>
                    <TableCell>{farmer.groupName || "-"}</TableCell>
                    <TableCell>{farmer.phoneNumber || "-"}</TableCell>
                    <TableCell>
                      {farmer.registrationStage === "pre_registered" ? (
                        <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300" data-testid={`stage-badge-${farmer.id}`}>Pre-registered</Badge>
                      ) : (
                        <Badge variant="secondary" data-testid={`stage-badge-${farmer.id}`}>Fully registered</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={farmer.status === 'active' ? 'default' : farmer.status === 'pending' ? 'secondary' : 'destructive'}>{farmer.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/farmers/${farmer.id}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {data && data.total > limit && (
            <div className="p-4 border-t flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Showing {(page - 1) * limit + 1} to {Math.min(page * limit, data.total)} of {data.total} farmers
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
                <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * limit >= data.total}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
