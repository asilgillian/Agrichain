import { useListSurveyTemplates, useListSurveySubmissions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";

const statusColors: Record<string, "default" | "secondary" | "destructive"> = {
  approved: "default",
  pending: "secondary",
  rejected: "destructive",
};

export default function SurveysPage() {
  const { data: templates, isLoading: isLoadingTemplates } = useListSurveyTemplates();
  const { data: submissions, isLoading: isLoadingSubmissions } = useListSurveySubmissions({});

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Survey Management</h1>
        <p className="text-muted-foreground mt-1">Survey templates and field submission review</p>
      </div>

      <Tabs defaultValue="submissions">
        <TabsList>
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="submissions" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Survey Submissions</CardTitle>
                <Badge variant="secondary">{isLoadingSubmissions ? "..." : (submissions?.length ?? 0)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template</TableHead>
                    <TableHead>Farmer</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Submitted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingSubmissions ? (
                    <TableRow><TableCell colSpan={5}><Skeleton className="h-12 w-full" /></TableCell></TableRow>
                  ) : submissions && submissions.length > 0 ? submissions.map(s => (
                    <TableRow key={s.id} data-testid={`submission-row-${s.id}`}>
                      <TableCell className="font-medium">{(s as any).templateName ?? "Survey"}</TableCell>
                      <TableCell>{(s as any).farmerName ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{(s as any).agentName ?? "—"}</TableCell>
                      <TableCell><Badge variant={statusColors[s.status ?? ""] ?? "secondary"}>{s.status}</Badge></TableCell>
                      <TableCell className="text-muted-foreground text-sm">{format(new Date(s.submittedAt), "MMM d, yyyy")}</TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No submissions</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Survey Templates</CardTitle>
                <Badge variant="secondary">{isLoadingTemplates ? "..." : (templates?.length ?? 0)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Fields</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingTemplates ? (
                    <TableRow><TableCell colSpan={4}><Skeleton className="h-12 w-full" /></TableCell></TableRow>
                  ) : templates && templates.length > 0 ? templates.map(t => (
                    <TableRow key={t.id} data-testid={`template-row-${t.id}`}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="capitalize">{t.type}</TableCell>
                      <TableCell>{Array.isArray(t.fields) ? t.fields.length : 0} fields</TableCell>
                      <TableCell><Badge variant={t.published ? "default" : "secondary"}>{t.published ? "Published" : "Draft"}</Badge></TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No templates</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
