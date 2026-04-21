import { useState } from "react";
import { useListUsers } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_PHONE_CODE } from "@/lib/currency";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");
const NO_REGION = "__none__";

type Role = { id: string; name: string; description?: string; permissions: string[]; isSystem?: boolean };
type Region = { id: string; name: string };
type StaffUser = {
  id: string; firstName: string; lastName: string; email: string;
  phoneNumber?: string | null; role: string;
  regionId?: string | null; status: string;
};

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "on_leave", label: "On leave" },
  { value: "deactivated", label: "Deactivated" },
];

const emptyForm = { firstName: "", lastName: "", email: "", phoneNumber: DEFAULT_PHONE_CODE, role: "", regionId: "" };

export default function StaffPage() {
  const { data: users, isLoading } = useListUsers({});
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [editUser, setEditUser] = useState<StaffUser | null>(null);
  const [editRole, setEditRole] = useState("");
  const [editRegion, setEditRegion] = useState<string>(NO_REGION);
  const [editStatus, setEditStatus] = useState("active");
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

  const createMut = useMutation({
    mutationFn: (body: any) => fetch(`${API_BASE}/api/users`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Staff member added" });
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
      toast({ title: "Staff member updated" });
      setEditUser(null);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const openEdit = (u: StaffUser) => {
    setEditUser(u);
    setEditRole(u.role);
    setEditRegion(u.regionId ?? NO_REGION);
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
    if (Object.keys(body).length === 0) {
      setEditUser(null);
      return;
    }
    updateMut.mutate({ id: editUser.id, body });
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Staff Management</h1>
          <p className="text-muted-foreground mt-1">User accounts, roles, and regional assignments</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{isLoading ? "..." : (users?.length ?? 0)} staff</Badge>
          <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) setCreateForm(emptyForm); }}>
            <DialogTrigger asChild>
              <Button className="gap-2" data-testid="add-staff-btn"><Plus className="h-4 w-4" /> Add Staff</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Staff Member</DialogTitle>
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
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={() => {
                  const fn = createForm.firstName.trim(); const ln = createForm.lastName.trim(); const em = createForm.email.trim(); const ph = createForm.phoneNumber.trim();
                  if (!fn || !ln || !em || !createForm.role) { toast({ title: "Name, email and role required", variant: "destructive" }); return; }
                  const body: any = { firstName: fn, lastName: ln, email: em, role: createForm.role };
                  if (ph && ph !== DEFAULT_PHONE_CODE) body.phoneNumber = ph;
                  if (createForm.regionId) body.regionId = createForm.regionId;
                  createMut.mutate(body);
                }} disabled={createMut.isPending} data-testid="submit-staff">{createMut.isPending ? "Saving..." : "Add"}</Button>
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
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3].map(i => <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-10 w-full" /></TableCell></TableRow>)
              ) : users && users.length > 0 ? users.map((u: any) => (
                <TableRow key={u.id} data-testid={`user-row-${u.id}`}>
                  <TableCell className="font-medium">{u.firstName} {u.lastName}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "Pending" ? "destructive" : "outline"} data-testid={`role-${u.id}`}>{u.role}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{regionName(u.regionId) ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{u.phoneNumber ?? "—"}</TableCell>
                  <TableCell><Badge variant={u.status === "active" ? "default" : "secondary"}>{u.status}</Badge></TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(u as StaffUser)} data-testid={`edit-user-${u.id}`} title="Edit role / region / status">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={7} className="py-12 text-center text-muted-foreground">No staff found</TableCell></TableRow>
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
