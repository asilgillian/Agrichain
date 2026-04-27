import { useMemo, useState } from "react";
import { useListUsers } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, Plus, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_PHONE_CODE } from "@/lib/currency";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");
const NO_REGION = "__none__";
const NO_MANAGER = "__none__";
const ALL = "__all__";

type Role = { id: string; name: string; description?: string; permissions: string[]; isSystem?: boolean };
type Region = { id: string; name: string };
type UserRecord = {
  id: string; firstName: string; lastName: string; email: string;
  phoneNumber?: string | null; role: string;
  regionId?: string | null; managerId?: string | null; status: string;
};

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "on_leave", label: "On leave" },
  { value: "deactivated", label: "Deactivated" },
];

const emptyForm = { firstName: "", lastName: "", email: "", phoneNumber: DEFAULT_PHONE_CODE, role: "", regionId: "", managerId: "" };

export default function UsersPage() {
  const { data: users, isLoading } = useListUsers({});
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [editUser, setEditUser] = useState<UserRecord | null>(null);
  const [editRole, setEditRole] = useState("");
  const [editRegion, setEditRegion] = useState<string>(NO_REGION);
  const [editManager, setEditManager] = useState<string>(NO_MANAGER);
  const [editStatus, setEditStatus] = useState("active");
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string>(ALL);
  const [filterRegion, setFilterRegion] = useState<string>(ALL);
  const [filterStatus, setFilterStatus] = useState<string>(ALL);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: roles } = useQuery<Role[]>({
    queryKey: ["/api/admin/roles"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/admin/roles`);
      if (!r.ok) throw new Error(`Failed to load roles (${r.status})`);
      return r.json();
    },
  });

  const { data: regions } = useQuery<Region[]>({
    queryKey: ["/api/admin/regions"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/admin/regions`);
      if (!r.ok) throw new Error(`Failed to load regions (${r.status})`);
      return r.json();
    },
  });

  const sortedRoles = (roles ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const regionName = (id?: string | null) => regions?.find(r => r.id === id)?.name;
  const userById = useMemo(() => {
    const m = new Map<string, UserRecord>();
    (users ?? []).forEach((u: any) => m.set(u.id, u));
    return m;
  }, [users]);
  const managerName = (id?: string | null) => {
    if (!id) return undefined;
    const m = userById.get(id);
    return m ? `${m.firstName} ${m.lastName}` : undefined;
  };

  const filteredUsers = useMemo(() => {
    if (!users) return [] as UserRecord[];
    const q = search.trim().toLowerCase();
    return (users as UserRecord[]).filter((u) => {
      if (filterRole !== ALL && u.role !== filterRole) return false;
      if (filterRegion !== ALL) {
        const rid = u.regionId ?? "";
        if (filterRegion === NO_REGION ? rid !== "" : rid !== filterRegion) return false;
      }
      if (filterStatus !== ALL && u.status !== filterStatus) return false;
      if (q) {
        const hay = `${u.firstName} ${u.lastName} ${u.email} ${u.phoneNumber ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [users, search, filterRole, filterRegion, filterStatus]);

  const hasActiveFilters = search.trim() !== "" || filterRole !== ALL || filterRegion !== ALL || filterStatus !== ALL;
  const clearFilters = () => { setSearch(""); setFilterRole(ALL); setFilterRegion(ALL); setFilterStatus(ALL); };

  const createMut = useMutation({
    mutationFn: (body: any) => fetch(`${API_BASE}/api/users`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User added" });
      setCreateOpen(false);
      setCreateForm(emptyForm);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: (vars: { id: string; body: any }) => fetch(`${API_BASE}/api/users/${vars.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(vars.body),
    }).then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User updated" });
      setEditUser(null);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const openEdit = (u: UserRecord) => {
    setEditUser(u);
    setEditRole(u.role);
    setEditRegion(u.regionId ?? NO_REGION);
    setEditManager(u.managerId ?? NO_MANAGER);
    setEditStatus(u.status);
  };

  const submitEdit = () => {
    if (!editUser) return;
    const body: any = {};
    if (editRole && editRole !== editUser.role) body.role = editRole;
    if (editStatus !== editUser.status) body.status = editStatus;
    const newRegion = editRegion === NO_REGION ? null : editRegion;
    const oldRegion = editUser.regionId ?? null;
    if (newRegion !== oldRegion) body.regionId = newRegion;
    const newManager = editManager === NO_MANAGER ? null : editManager;
    const oldManager = editUser.managerId ?? null;
    if (newManager !== oldManager) body.managerId = newManager;
    if (Object.keys(body).length === 0) {
      setEditUser(null);
      return;
    }
    updateMut.mutate({ id: editUser.id, body });
  };

  const managerCandidates = (users as UserRecord[] | undefined)?.filter(u => u.id !== editUser?.id) ?? [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground mt-1">User accounts, roles, and regional assignments</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{isLoading ? "..." : `${filteredUsers.length}${hasActiveFilters ? ` of ${users?.length ?? 0}` : ""} users`}</Badge>
          <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) setCreateForm(emptyForm); }}>
            <DialogTrigger asChild>
              <Button className="gap-2" data-testid="add-user-btn"><Plus className="h-4 w-4" /> Add User</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add User</DialogTitle>
                <DialogDescription>Create a new user account with a defined role and region.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>First Name *</Label><Input value={createForm.firstName} onChange={e => setCreateForm({ ...createForm, firstName: e.target.value })} data-testid="input-first-name" /></div>
                  <div><Label>Last Name *</Label><Input value={createForm.lastName} onChange={e => setCreateForm({ ...createForm, lastName: e.target.value })} data-testid="input-last-name" /></div>
                </div>
                <div><Label>Email *</Label><Input type="email" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} data-testid="input-email" /></div>
                <div><Label>Phone</Label><Input value={createForm.phoneNumber} onChange={e => setCreateForm({ ...createForm, phoneNumber: e.target.value })} data-testid="input-phone" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Role *</Label>
                    <Select value={createForm.role} onValueChange={v => setCreateForm({ ...createForm, role: v })}>
                      <SelectTrigger data-testid="input-role"><SelectValue placeholder="Select role" /></SelectTrigger>
                      <SelectContent>
                        {sortedRoles.map(r => <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Region</Label>
                    <Select value={createForm.regionId || NO_REGION} onValueChange={v => setCreateForm({ ...createForm, regionId: v === NO_REGION ? "" : v })}>
                      <SelectTrigger data-testid="input-region"><SelectValue placeholder="Select region" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_REGION}>— None —</SelectItem>
                        {regions?.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Reports to</Label>
                  <Select value={createForm.managerId || NO_MANAGER} onValueChange={v => setCreateForm({ ...createForm, managerId: v === NO_MANAGER ? "" : v })}>
                    <SelectTrigger data-testid="input-manager"><SelectValue placeholder="Select manager" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_MANAGER}>— None —</SelectItem>
                      {(users as UserRecord[] | undefined)?.map(m => (
                        <SelectItem key={m.id} value={m.id}>{m.firstName} {m.lastName} · {m.role}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={() => {
                  const fn = createForm.firstName.trim(); const ln = createForm.lastName.trim(); const em = createForm.email.trim(); const ph = createForm.phoneNumber.trim();
                  if (!fn || !ln || !em || !createForm.role) { toast({ title: "Name, email and role required", variant: "destructive" }); return; }
                  const body: any = { firstName: fn, lastName: ln, email: em, role: createForm.role };
                  if (ph && ph !== DEFAULT_PHONE_CODE) body.phoneNumber = ph;
                  if (createForm.regionId) body.regionId = createForm.regionId;
                  if (createForm.managerId) body.managerId = createForm.managerId;
                  createMut.mutate(body);
                }} disabled={createMut.isPending} data-testid="submit-user">{createMut.isPending ? "Saving..." : "Add"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <Label className="text-xs">Search</Label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, email, phone..."
                  className="pl-8"
                  data-testid="user-search"
                />
              </div>
            </div>
            <div className="w-44">
              <Label className="text-xs">Role</Label>
              <Select value={filterRole} onValueChange={setFilterRole}>
                <SelectTrigger data-testid="filter-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All roles</SelectItem>
                  {sortedRoles.map(r => <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-44">
              <Label className="text-xs">Region</Label>
              <Select value={filterRegion} onValueChange={setFilterRegion}>
                <SelectTrigger data-testid="filter-region"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All regions</SelectItem>
                  <SelectItem value={NO_REGION}>— No region —</SelectItem>
                  {regions?.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-40">
              <Label className="text-xs">Status</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger data-testid="filter-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  {STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="clear-filters" className="gap-1">
                <X className="h-4 w-4" /> Clear
              </Button>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Reports to</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3].map(i => <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-10 w-full" /></TableCell></TableRow>)
              ) : filteredUsers.length > 0 ? filteredUsers.map((u) => (
                <TableRow key={u.id} data-testid={`user-row-${u.id}`}>
                  <TableCell className="font-medium">{u.firstName} {u.lastName}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "Pending" ? "destructive" : "outline"} data-testid={`role-${u.id}`}>{u.role}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{regionName(u.regionId) ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground" data-testid={`manager-${u.id}`}>{managerName(u.managerId) ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{u.phoneNumber ?? "—"}</TableCell>
                  <TableCell><Badge variant={u.status === "active" ? "default" : "secondary"}>{u.status}</Badge></TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(u)} data-testid={`edit-user-${u.id}`} title="Edit role / region / manager / status">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                  {hasActiveFilters ? "No users match these filters" : "No users found"}
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editUser} onOpenChange={(o) => { if (!o) setEditUser(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editUser?.firstName} {editUser?.lastName}</DialogTitle>
            <DialogDescription>{editUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Role *</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger data-testid="edit-role-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sortedRoles.map(r => <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {editRole && roles?.find(r => r.name === editRole) && (
                <p className="text-xs text-muted-foreground mt-1">
                  {roles.find(r => r.name === editRole)?.permissions.length ?? 0} permission(s) granted
                </p>
              )}
            </div>
            <div>
              <Label>Region</Label>
              <Select value={editRegion} onValueChange={setEditRegion}>
                <SelectTrigger data-testid="edit-region-select"><SelectValue placeholder="Select region" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_REGION}>— None —</SelectItem>
                  {regions?.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reports to</Label>
              <Select value={editManager} onValueChange={setEditManager}>
                <SelectTrigger data-testid="edit-manager-select"><SelectValue placeholder="Select manager" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_MANAGER}>— None —</SelectItem>
                  {managerCandidates.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.firstName} {m.lastName} · {m.role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger data-testid="edit-status-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button onClick={submitEdit} disabled={updateMut.isPending} data-testid="submit-edit-user">
              {updateMut.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
