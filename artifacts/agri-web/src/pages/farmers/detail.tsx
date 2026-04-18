import { useParams } from "wouter";
import { useGetFarmer } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Map, ShieldCheck, MapPin, Calendar, Phone, Users, Activity } from "lucide-react";
import { format } from "date-fns";

export default function FarmerDetail() {
  const { id } = useParams<{ id: string }>();
  
  const { data: farmer, isLoading } = useGetFarmer(id, { 
    query: { enabled: !!id, queryKey: ['/api/farmers', id] as const } 
  });

  if (isLoading) {
    return <div className="p-8 space-y-6"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (!farmer) {
    return <div className="p-8 text-center">Farmer not found</div>;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 border-2 border-border">
            <AvatarImage src={farmer.photoUrl} />
            <AvatarFallback className="text-xl">{farmer.firstName[0]}{farmer.lastName[0]}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{farmer.firstName} {farmer.lastName}</h1>
            <div className="flex items-center gap-3 mt-1 text-muted-foreground">
              <span className="font-mono text-sm">{farmer.referenceNumber}</span>
              <span>•</span>
              <Badge variant={farmer.status === 'active' ? 'default' : 'secondary'}>{farmer.status}</Badge>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">Edit Profile</Button>
          <Button>Log Visit</Button>
        </div>
      </div>

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
            <CardHeader>
              <CardTitle>Registered Plots</CardTitle>
              <CardDescription>Land parcels associated with this farmer</CardDescription>
            </CardHeader>
            <CardContent>
              {farmer.plots && farmer.plots.length > 0 ? (
                <div className="space-y-4">
                  {farmer.plots.map(plot => (
                    <div key={plot.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg border">
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                          <Map className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="font-semibold">{plot.name || `Plot ${plot.id.slice(0,6)}`}</h4>
                          <p className="text-sm text-muted-foreground">{plot.cropType} • {plot.areaHectares} Hectares</p>
                        </div>
                      </div>
                      <div className="mt-4 sm:mt-0 flex items-center gap-3">
                        <Badge variant={plot.status === 'active' ? 'default' : 'secondary'}>{plot.status}</Badge>
                        <Button variant="outline" size="sm">View Map</Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground border rounded-lg border-dashed">
                  No plots registered
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
                        <p className="text-sm text-muted-foreground">By {survey.agentName} on {format(new Date(survey.submittedAt), 'MMM d, yyyy')}</p>
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

function InfoRow({ icon: Icon, label, value }: { icon: any, label: string, value?: string }) {
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
