import { useState } from "react";
import { Link } from "wouter";
import { useListFarmers, useListGroups } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Filter } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_PHONE_CODE } from "@/lib/currency";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

const emptyForm = {
  firstName: "",
  lastName: "",
  nationalId: "",
  phoneNumber: DEFAULT_PHONE_CODE,
  sex: "male",
  village: "",
  groupId: "",
  regionId: "",
};

export default function FarmersList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const { toast } = useToast();
  const qc = useQueryClient();
  const limit = 20;

  const { data, isLoading } = useListFarmers({ page, limit, search: search || undefined });
  const { data: groups } = useListGroups({});
  const { data: regions } = useQuery<any[]>({
    queryKey: ["/api/admin/regions"],
    queryFn: () => fetch(`${API_BASE}/api/admin/regions`).then(r => r.json()),
  });

  const createMut = useMutation({
    mutationFn: (body: any) =>
      fetch(`${API_BASE}/api/farmers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/farmers"] });
      toast({ title: "Farmer registered" });
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const submit = () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.nationalId.trim() || !form.groupId || !form.regionId) {
      toast({ title: "Missing fields", description: "Name, ID, group and region are required", variant: "destructive" });
      return;
    }
    const body: any = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      nationalId: form.nationalId.trim(),
      sex: form.sex,
      groupId: form.groupId,
      regionId: form.regionId,
    };
    const phone = form.phoneNumber.trim();
    if (phone && phone !== DEFAULT_PHONE_CODE) body.phoneNumber = phone;
    if (form.village.trim()) body.village = form.village.trim();
    createMut.mutate(body);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Farmer Registry</h1>
          <p className="text-muted-foreground mt-1">Manage and monitor registered farmers.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" data-testid="add-farmer-btn"><Plus className="h-4 w-4" /> Add Farmer</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Register New Farmer</DialogTitle>
              <DialogDescription>Enter the farmer's details. National ID and group are required.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>First Name *</Label><Input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} data-testid="input-first-name" /></div>
                <div><Label>Last Name *</Label><Input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} data-testid="input-last-name" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>National ID *</Label><Input value={form.nationalId} onChange={e => setForm({ ...form, nationalId: e.target.value })} data-testid="input-national-id" /></div>
                <div><Label>Phone</Label><Input value={form.phoneNumber} onChange={e => setForm({ ...form, phoneNumber: e.target.value })} placeholder="+256..." data-testid="input-phone" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Sex</Label>
                  <Select value={form.sex} onValueChange={v => setForm({ ...form, sex: v })}>
                    <SelectTrigger data-testid="input-sex"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Village</Label><Input value={form.village} onChange={e => setForm({ ...form, village: e.target.value })} data-testid="input-village" /></div>
              </div>
              <div>
                <Label>Region *</Label>
                <Select value={form.regionId} onValueChange={v => setForm({ ...form, regionId: v })}>
                  <SelectTrigger data-testid="input-region"><SelectValue placeholder="Select region" /></SelectTrigger>
                  <SelectContent>
                    {Array.isArray(regions) && regions.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Group *</Label>
                <Select value={form.groupId} onValueChange={v => setForm({ ...form, groupId: v })}>
                  <SelectTrigger data-testid="input-group"><SelectValue placeholder="Select cooperative group" /></SelectTrigger>
                  <SelectContent>
                    {groups?.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={createMut.isPending} data-testid="submit-farmer">{createMut.isPending ? "Saving..." : "Register"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <div className="p-4 border-b flex flex-col sm:flex-row gap-4 items-center justify-between bg-muted/20">
          <div className="relative w-full sm:max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by name, ID, or phone..."
              className="pl-8 bg-background"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" className="gap-2 w-full sm:w-auto">
            <Filter className="h-4 w-4" /> Filters
          </Button>
        </div>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Farmer</TableHead>
                <TableHead>Ref Number</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Phone</TableHead>
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
                    <TableCell className="text-right"><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : data?.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No farmers found.</TableCell>
                </TableRow>
              ) : (
                data?.data.map((farmer) => (
                  <TableRow key={farmer.id} className="hover:bg-muted/50 cursor-pointer">
                    <TableCell>
                      <Link href={`/farmers/${farmer.id}`} className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={farmer.photoUrl} alt={`${farmer.firstName} ${farmer.lastName}`} />
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
