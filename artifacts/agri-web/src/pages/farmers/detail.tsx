import { useParams } from "wouter";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Map as MapIcon, ShieldCheck, MapPin, Calendar, Phone, Users, AlertCircle, CheckCircle2, Plus } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { PlotDrawMap, type DrawnGeometry } from "@/components/plots/PlotDrawMap";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

type FarmerDetailResponse = {
  id: string;
  firstName: string;
  lastName: string;
  referenceNumber: string;
  status: string;
  registrationStage: "pre_registered" | "fully_registered";
  preRegisteredAt: string | null;
  fullyRegisteredAt: string | null;
  phoneNumber: string | null;
  village: string | null;
  groupName: string | null;
  nationalId: string | null;
  sex: string | null;
  photoUrl: string | null;
  createdAt: string;
  plots: Array<{ id: string; name: string | null; cropType: string; areaHectares: number; status: string; polygon: any | null }>;
  certifications: Array<{ id: string; streamName: string; status: string; enrolmentDate: string }>;
  recentSurveys: Array<{ id: string; templateName?: string; agentName?: string; submittedAt: string; status: string }>;
  gapScore: number | null;
};

export default function FarmerDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { has } = usePermissions();
  const canComplete = has("farmers.register");
  const canMapPlot = has("plots.gps_map");

  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeForm, setCompleteForm] = useState({
    nationalId: "",
    sex: "",
    dateOfBirth: "",
    village: "",
    phoneNumber: "",
    headOfHousehold: "",
    landTenure: "",
    householdSize: "",
    dependants: "",
  });
  const [plotOpen, setPlotOpen] = useState(false);
  const [plotForm, setPlotForm] = useState({ name: "", cropType: "Coffee", areaHectares: "" });
  const [plotMode, setPlotMode] = useState<"point" | "polygon">("point");
  const [plotGeom, setPlotGeom] = useState<DrawnGeometry | null>(null);

  const { data: farmer, isLoading } = useQuery<FarmerDetailResponse>({
    queryKey: ["/api/farmers", id],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/farmers/${id}`);
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`Failed to load farmer (${r.status}): ${text.slice(0, 200)}`);
      }
      return r.json();
    },
    enabled: !!id,
  });

  const completeMut = useMutation({
    mutationFn: (body: any) =>
      fetch(`${API_BASE}/api/farmers/${id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/farmers"] });
      qc.invalidateQueries({ queryKey: ["/api/farmers", id] });
      toast({ title: "Farmer fully registered", description: "KYC details captured and farmer activated." });
      setCompleteOpen(false);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const plotMut = useMutation({
    mutationFn: (body: any) =>
      fetch(`${API_BASE}/api/plots`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/farmers", id] });
      toast({ title: "Plot added" });
      setPlotOpen(false);
      setPlotForm({ name: "", cropType: "Coffee", areaHectares: "" });
      setPlotGeom(null);
    },
    onError: (e: any) => toast({ title: "Plot creation failed", description: e.message, variant: "destructive" }),
  });

  const submitComplete = () => {
    if (!completeForm.nationalId.trim()) {
      toast({ title: "National ID required", description: "A national ID is required for full registration.", variant: "destructive" });
      return;
    }
    const body: any = { nationalId: completeForm.nationalId.trim() };
    if (completeForm.sex) body.sex = completeForm.sex;
    if (completeForm.dateOfBirth) body.dateOfBirth = completeForm.dateOfBirth;
    if (completeForm.village.trim()) body.village = completeForm.village.trim();
    if (completeForm.phoneNumber.trim()) body.phoneNumber = completeForm.phoneNumber.trim();
    if (completeForm.headOfHousehold.trim()) body.headOfHousehold = completeForm.headOfHousehold.trim();
    if (completeForm.landTenure) body.landTenure = completeForm.landTenure;
    if (completeForm.householdSize) body.householdSize = parseInt(completeForm.householdSize, 10);
    if (completeForm.dependants) body.dependants = parseInt(completeForm.dependants, 10);
    completeMut.mutate(body);
  };

  const submitPlot = () => {
    const area = parseFloat(plotForm.areaHectares);
    if (!plotForm.cropType.trim() || !Number.isFinite(area) || area < 0) {
      toast({ title: "Missing fields", description: "Crop type and area (hectares) are required.", variant: "destructive" });
      return;
    }
    if (!plotGeom) {
      toast({ title: "Map the plot", description: "Drop a pin or draw the polygon outline on the map.", variant: "destructive" });
      return;
    }
    const body: any = {
      farmerId: id,
      cropType: plotForm.cropType.trim(),
      areaHectares: area,
      polygon: plotGeom,
    };
    if (plotForm.name.trim()) body.name = plotForm.name.trim();
    plotMut.mutate(body);
  };

  // Browser geolocation -> drop a single pin. Falls back to a clear error toast on denial.
  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast({ title: "Geolocation not available", description: "This browser doesn't support GPS.", variant: "destructive" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setPlotMode("point");
        setPlotGeom({ type: "Point", coordinates: [pos.coords.longitude, pos.coords.latitude] });
        toast({ title: "Pin placed", description: `±${Math.round(pos.coords.accuracy)}m accuracy` });
      },
      err => toast({ title: "Couldn't get location", description: err.message, variant: "destructive" }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  if (isLoading) {
    return <div className="p-8 space-y-6"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (!farmer) {
    return <div className="p-8 text-center">Farmer not found</div>;
  }

  const isPreRegistered = farmer.registrationStage === "pre_registered";

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 border-2 border-border">
            <AvatarImage src={farmer.photoUrl ?? undefined} />
            <AvatarFallback className="text-xl">{farmer.firstName[0]}{farmer.lastName[0]}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{farmer.firstName} {farmer.lastName}</h1>
            <div className="flex items-center gap-3 mt-1 text-muted-foreground flex-wrap">
              <span className="font-mono text-sm">{farmer.referenceNumber}</span>
              <span>•</span>
              <Badge variant={farmer.status === 'active' ? 'default' : 'secondary'}>{farmer.status}</Badge>
              {isPreRegistered ? (
                <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300" data-testid="detail-stage-badge">Pre-registered</Badge>
              ) : (
                <Badge variant="secondary" data-testid="detail-stage-badge">Fully registered</Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">Edit Profile</Button>
          <Button>Log Visit</Button>
        </div>
      </div>

      {/* Pre-registration banner — only when farmer is pre_registered */}
      {isPreRegistered && (
        <Card className="border-amber-400 bg-amber-50 dark:bg-amber-950/30" data-testid="prereg-banner">
          <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">This farmer is pre-registered</p>
                <p className="text-sm text-muted-foreground">National ID and KYC details are still required to complete registration.</p>
              </div>
            </div>
            <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 shrink-0" disabled={!canComplete} data-testid="complete-registration-btn">
                  <CheckCircle2 className="h-4 w-4" /> Complete Full Registration
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Complete Full Registration</DialogTitle>
                  <DialogDescription>Capture the missing KYC details. The farmer will be marked active once saved.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>National ID *</Label>
                    <Input value={completeForm.nationalId} onChange={e => setCompleteForm({ ...completeForm, nationalId: e.target.value })} data-testid="complete-national-id" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Sex</Label>
                      <Select value={completeForm.sex} onValueChange={v => setCompleteForm({ ...completeForm, sex: v })}>
                        <SelectTrigger data-testid="complete-sex"><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Date of Birth</Label>
                      <Input type="date" value={completeForm.dateOfBirth} onChange={e => setCompleteForm({ ...completeForm, dateOfBirth: e.target.value })} data-testid="complete-dob" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Village</Label><Input value={completeForm.village} onChange={e => setCompleteForm({ ...completeForm, village: e.target.value })} /></div>
                    <div><Label>Phone</Label><Input value={completeForm.phoneNumber} onChange={e => setCompleteForm({ ...completeForm, phoneNumber: e.target.value })} placeholder="+256..." /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Head of household</Label><Input value={completeForm.headOfHousehold} onChange={e => setCompleteForm({ ...completeForm, headOfHousehold: e.target.value })} /></div>
                    <div>
                      <Label>Land tenure</Label>
                      <Select value={completeForm.landTenure} onValueChange={v => setCompleteForm({ ...completeForm, landTenure: v })}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="owned">Owned</SelectItem>
                          <SelectItem value="rented">Rented</SelectItem>
                          <SelectItem value="customary">Customary</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Household size</Label><Input type="number" value={completeForm.householdSize} onChange={e => setCompleteForm({ ...completeForm, householdSize: e.target.value })} /></div>
                    <div><Label>Dependants</Label><Input type="number" value={completeForm.dependants} onChange={e => setCompleteForm({ ...completeForm, dependants: e.target.value })} /></div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCompleteOpen(false)}>Cancel</Button>
                  <Button onClick={submitComplete} disabled={completeMut.isPending} data-testid="submit-complete">{completeMut.isPending ? "Saving..." : "Complete registration"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Profile Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <InfoRow icon={Phone} label="Phone" value={farmer.phoneNumber} />
            <InfoRow icon={MapPin} label="Village" value={farmer.village} />
            <InfoRow icon={Users} label="Group" value={farmer.groupName} />
            <InfoRow icon={Calendar} label="Registered" value={format(new Date(farmer.createdAt), 'MMM d, yyyy')} />
            {farmer.nationalId && <InfoRow icon={ShieldCheck} label="National ID" value={farmer.nationalId} />}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Key Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg bg-muted/30 border">
                <p className="text-sm text-muted-foreground mb-1">Total Plots</p>
                <p className="text-2xl font-bold">{farmer.plots?.length || 0}</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/30 border">
                <p className="text-sm text-muted-foreground mb-1">Total Area</p>
                <p className="text-2xl font-bold">
                  {farmer.plots?.reduce((sum, p) => sum + p.areaHectares, 0).toFixed(2) || "0.00"} <span className="text-base font-normal text-muted-foreground">Ha</span>
                </p>
              </div>
              <div className="p-4 rounded-lg bg-muted/30 border">
                <p className="text-sm text-muted-foreground mb-1">GAP Score</p>
                <p className="text-2xl font-bold">{farmer.gapScore ? `${farmer.gapScore}%` : "N/A"}</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/30 border">
                <p className="text-sm text-muted-foreground mb-1">Certifications</p>
                <p className="text-2xl font-bold">{farmer.certifications?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="plots" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="plots">Plots & Maps</TabsTrigger>
          <TabsTrigger value="certifications">Certifications</TabsTrigger>
          <TabsTrigger value="surveys">Surveys</TabsTrigger>
        </TabsList>

        <TabsContent value="plots" className="mt-6">
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle>Registered Plots</CardTitle>
                <CardDescription>Land parcels associated with this farmer</CardDescription>
              </div>
              <Dialog
                open={plotOpen}
                onOpenChange={(open) => {
                  setPlotOpen(open);
                  // Always reset the form state when the dialog closes (Cancel, X, outside click)
                  // so re-opening starts clean — important for field capture where stale geometry
                  // would silently attach to the wrong plot.
                  if (!open) {
                    setPlotForm({ name: "", cropType: "Coffee", areaHectares: "" });
                    setPlotMode("point");
                    setPlotGeom(null);
                  }
                }}
              >
                <DialogTrigger asChild>
                  <Button className="gap-2" disabled={!canMapPlot} data-testid="add-plot-btn"><Plus className="h-4 w-4" /> Add Plot</Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>Map a New Plot</DialogTitle>
                    <DialogDescription>Choose a single GPS pin or outline a polygon. Polygons will be checked for overlap with existing plots.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="sm:col-span-1">
                        <Label>Plot name</Label>
                        <Input value={plotForm.name} onChange={e => setPlotForm({ ...plotForm, name: e.target.value })} placeholder="Optional label" data-testid="plot-name" />
                      </div>
                      <div>
                        <Label>Crop *</Label>
                        <Select value={plotForm.cropType} onValueChange={v => setPlotForm({ ...plotForm, cropType: v })}>
                          <SelectTrigger data-testid="plot-crop"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["Coffee", "Maize", "Beans", "Cassava", "Banana", "Tea", "Cotton", "Sorghum"].map(c =>
                              <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Area (hectares) *</Label>
                        <Input type="number" min="0" step="0.01" value={plotForm.areaHectares} onChange={e => setPlotForm({ ...plotForm, areaHectares: e.target.value })} data-testid="plot-area" />
                      </div>
                    </div>
                    <PlotDrawMap
                      mode={plotMode}
                      value={plotGeom}
                      onChange={setPlotGeom}
                      onModeChange={setPlotMode}
                      onUseMyLocation={useMyLocation}
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setPlotOpen(false)}>Cancel</Button>
                    <Button onClick={submitPlot} disabled={plotMut.isPending} data-testid="submit-plot">{plotMut.isPending ? "Saving..." : "Save plot"}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {farmer.plots && farmer.plots.length > 0 ? (
                <div className="space-y-4">
                  {farmer.plots.map(plot => (
                    <div key={plot.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg border" data-testid={`plot-row-${plot.id}`}>
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                          <MapIcon className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="font-semibold">{plot.name || `Plot ${plot.id.slice(0, 6)}`}</h4>
                          <p className="text-sm text-muted-foreground">
                            {plot.cropType} • {plot.areaHectares} Ha
                            {plot.polygon?.type === "Polygon" && <span> • Polygon mapped</span>}
                            {plot.polygon?.type === "Point" && <span> • Pin only</span>}
                            {!plot.polygon && <span> • No GPS</span>}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 sm:mt-0 flex items-center gap-3">
                        <Badge variant={plot.status === 'active' ? 'default' : 'secondary'}>{plot.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground border rounded-lg border-dashed">
                  No plots registered. Click "Add Plot" to map one.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="certifications" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Certification Enrolments</CardTitle>
              <CardDescription>Active and historical certification programs</CardDescription>
            </CardHeader>
            <CardContent>
              {farmer.certifications && farmer.certifications.length > 0 ? (
                <div className="space-y-4">
                  {farmer.certifications.map(cert => (
                    <div key={cert.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg border">
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 dark:bg-blue-900/30">
                          <ShieldCheck className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="font-semibold">{cert.streamName}</h4>
                          <p className="text-sm text-muted-foreground">Enrolled: {format(new Date(cert.enrolmentDate), 'MMM d, yyyy')}</p>
                        </div>
                      </div>
                      <div className="mt-4 sm:mt-0 flex items-center gap-3">
                        <Badge variant={cert.status === 'active' ? 'default' : 'secondary'}>{cert.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground border rounded-lg border-dashed">
                  No certifications enrolled
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="surveys" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent Surveys & Visits</CardTitle>
            </CardHeader>
            <CardContent>
              {farmer.recentSurveys && farmer.recentSurveys.length > 0 ? (
                <div className="space-y-4">
                  {farmer.recentSurveys.map(survey => (
                    <div key={survey.id} className="p-4 rounded-lg border flex justify-between items-center">
                      <div>
                        <h4 className="font-semibold">{survey.templateName || "Survey"}</h4>
                        <p className="text-sm text-muted-foreground">By {survey.agentName ?? "Agent"} on {format(new Date(survey.submittedAt), 'MMM d, yyyy')}</p>
                      </div>
                      <Badge variant="outline">{survey.status}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground border rounded-lg border-dashed">
                  No recent surveys
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: any, label: string, value?: string | null }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div className="flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value || "-"}</p>
      </div>
    </div>
  );
}
