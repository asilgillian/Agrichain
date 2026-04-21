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
import { Link } from "wouter";
import { ChevronRight, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_PHONE_CODE } from "@/lib/currency";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

const roleLabels: Record<string, string> = {
  Agronomist: "Field Agent (Agronomist)",
  Farmer: "Farmer",
  Manager: "Manager",
  Supervisor: "Supervisor",
  GroupLeader: "Group Leader",
  BuyingStationAgent: "Buying Station Agent",
  QualityInspector: "Quality Inspector",
  TradeDesk: "Trade Desk",
  ProcurementHead: "Procurement Head",
  FinanceOfficer: "Finance Officer",
  SystemAdministrator: "System Administrator",
  WarehouseManager: "Warehouse Manager",
  LogisticsOfficer: "Logistics Officer",
  ComplianceOfficer: "Compliance Officer",
};

const emptyForm = { firstName: "", lastName: "", email: "", phoneNumber: DEFAULT_PHONE_CODE, role: "Agronomist", regionId: "" };

export default function StaffPage() {
  const { data: users, isLoading } = useListUsers({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: regions } = useQuery<any[]>({
    queryKey: ["/api/admin/regions"],
    queryFn: () => fetch(`${API_BASE}/api/admin/regions`).then(r => r.json()),
  });

  const createMut = useMutation({
    mutationFn: (body: any) => fetch(`${API_BASE}/api/users`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Staff member added" });
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Staff Management</h1>
          <p className="text-muted-foreground mt-1">User accounts, roles, and regional assignments</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{isLoading ? "..." : (users?.length ?? 0)} staff</Badge>
          <Dialog open={open} onOpenChange={setOpen}>
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
                  <div><Label>First Name *</Label><Input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} data-testid="input-first-name" /></div>
                  <div><Label>Last Name *</Label><Input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} data-testid="input-last-name" /></div>
                </div>
                <div><Label>Email *</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} data-testid="input-email" /></div>
                <div><Label>Phone</Label><Input value={form.phoneNumber} onChange={e => setForm({ ...form, phoneNumber: e.target.value })} data-testid="input-phone" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Role *</Label>
                    <Select value={form.role} onValueChange={v => setForm({ ...form, role: v })}>
                      <SelectTrigger data-testid="input-role"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(roleLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Region</Label>
                    <Select value={form.regionId} onValueChange={v => setForm({ ...form, regionId: v })}>
                      <SelectTrigger data-testid="input-region"><SelectValue placeholder="Select region" /></SelectTrigger>
                      <SelectContent>
                        {regions?.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => {
                  const fn = form.firstName.trim(); const ln = form.lastName.trim(); const em = form.email.trim(); const ph = form.phoneNumber.trim();
                  if (!fn || !ln || !em || !form.role) { toast({ title: "Name, email and role required", variant: "destructive" }); return; }
                  const body: any = { firstName: fn, lastName: ln, email: em, role: form.role };
                  if (ph && ph !== DEFAULT_PHONE_CODE) body.phoneNumber = ph;
                  if (form.regionId) body.regionId = form.regionId;
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
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3].map(i => <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-10 w-full" /></TableCell></TableRow>)
              ) : users && users.length > 0 ? users.map(u => (
                <TableRow key={u.id} data-testid={`user-row-${u.id}`}>
                  <TableCell className="font-medium">{u.firstName} {u.lastName}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell><Badge variant="outline">{roleLabels[u.role] ?? u.role}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{u.phoneNumber ?? "—"}</TableCell>
                  <TableCell><Badge variant={u.status === "active" ? "default" : "secondary"}>{u.status}</Badge></TableCell>
                  <TableCell>
                    <Link href={`/staff/${u.id}`}><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={6} className="py-12 text-center text-muted-foreground">No staff found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
