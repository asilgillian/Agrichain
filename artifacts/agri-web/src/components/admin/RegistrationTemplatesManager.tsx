import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowDown, ArrowUp, CheckCircle2, FileText, Plus, Save, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

type CoreField = {
  fieldKey: string;
  label: string;
  fieldType: "text" | "number" | "date" | "choice" | "multichoice" | "yesno";
  source: "core_farmer" | "core_livelihood";
  alwaysRequired?: boolean;
  options?: { value: string; label: string }[] | null;
};

type Template = {
  id: string;
  name: string;
  description: string | null;
  countryCode: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type Field = {
  id?: string;
  fieldKey: string;
  label: string;
  fieldType: "text" | "number" | "date" | "choice" | "multichoice" | "yesno";
  required: boolean;
  source: "core_farmer" | "core_livelihood" | "custom";
  options: { value: string; label: string }[] | null;
  sortOrder: number;
};

const FIELD_TYPES: Field["fieldType"][] = ["text", "number", "date", "choice", "multichoice", "yesno"];

// Slugify a label into a snake_case key. The server further validates uniqueness
// per template; we just produce something predictable so admins don't have to
// type the key by hand.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export function RegistrationTemplatesManager() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ["/api/admin/registration-templates"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/admin/registration-templates`);
      if (!r.ok) throw new Error(`Failed to load templates (${r.status})`);
      return r.json();
    },
  });

  const { data: coreFields } = useQuery<CoreField[]>({
    queryKey: ["/api/registration-templates/core-fields"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/registration-templates/core-fields`);
      if (!r.ok) throw new Error(`Failed to load core fields catalog (${r.status})`);
      return r.json();
    },
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", description: "", countryCode: "UG" });

  const createMut = useMutation({
    mutationFn: (body: { name: string; description?: string; countryCode?: string }) =>
      fetch(`${API_BASE}/api/admin/registration-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
        return r.json();
      }),
    onSuccess: (created: Template) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/registration-templates"] });
      toast({ title: "Template created" });
      setCreateOpen(false);
      setCreateForm({ name: "", description: "", countryCode: "UG" });
      setEditingId(created.id);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const activateMut = useMutation({
    mutationFn: (id: string) =>
      fetch(`${API_BASE}/api/admin/registration-templates/${id}/activate`, { method: "POST" })
        .then(async (r) => {
          if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
          return r.json();
        }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/registration-templates"] });
      qc.invalidateQueries({ queryKey: ["/api/registration-templates/active"] });
      toast({ title: "Template activated" });
    },
    onError: (e: any) => toast({ title: "Activation failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      fetch(`${API_BASE}/api/admin/registration-templates/${id}`, { method: "DELETE" })
        .then(async (r) => {
          if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
        }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/registration-templates"] });
      toast({ title: "Template deleted" });
      if (editingId) setEditingId(null);
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  if (editingId) {
    return (
      <TemplateEditor
        templateId={editingId}
        coreFields={coreFields ?? []}
        onClose={() => setEditingId(null)}
      />
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Registration Templates</CardTitle>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" data-testid="new-template-btn">
              <Plus className="h-4 w-4" /> New Template
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create registration template</DialogTitle>
              <DialogDescription>
                Templates control which registration fields are required. One active template per country (or
                global) at a time.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name *</Label>
                <Input
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder="e.g. Uganda Coffee Farmer 2026"
                  data-testid="input-template-name"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  rows={2}
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                />
              </div>
              <div>
                <Label>Country code</Label>
                <Input
                  value={createForm.countryCode}
                  onChange={(e) => setCreateForm({ ...createForm, countryCode: e.target.value.toUpperCase() })}
                  placeholder="UG (leave blank for global)"
                  maxLength={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() =>
                  createMut.mutate({
                    name: createForm.name.trim(),
                    description: createForm.description.trim() || undefined,
                    countryCode: createForm.countryCode.trim() || undefined,
                  })
                }
                disabled={!createForm.name.trim() || createMut.isPending}
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {(!templates || templates.length === 0) ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No templates yet. Create one to start customizing registration fields.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id} data-testid={`template-row-${t.id}`}>
                  <TableCell>
                    <div className="font-medium">{t.name}</div>
                    {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                  </TableCell>
                  <TableCell>{t.countryCode ?? <span className="text-muted-foreground">Global</span>}</TableCell>
                  <TableCell>
                    {t.isActive ? (
                      <Badge variant="default" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(t.updatedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => setEditingId(t.id)} data-testid={`edit-template-${t.id}`}>
                      Edit fields
                    </Button>
                    {!t.isActive && (
                      <Button size="sm" onClick={() => activateMut.mutate(t.id)} disabled={activateMut.isPending}>
                        Activate
                      </Button>
                    )}
                    {!t.isActive && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          if (confirm(`Delete "${t.name}"?`)) deleteMut.mutate(t.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TemplateEditor({
  templateId,
  coreFields,
  onClose,
}: {
  templateId: string;
  coreFields: CoreField[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ template: Template; fields: Field[] }>({
    queryKey: ["/api/admin/registration-templates", templateId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/admin/registration-templates/${templateId}`);
      if (!r.ok) throw new Error(`Failed to load template (${r.status})`);
      return r.json();
    },
  });

  const [fields, setFields] = useState<Field[]>([]);
  // Hydrate the local field list once the server data arrives. We keep edits
  // local and only push them on Save (matches the all-fields PUT contract).
  useEffect(() => {
    if (data?.fields) {
      setFields(
        data.fields.map((f, i) => ({
          ...f,
          options: Array.isArray(f.options) ? f.options : null,
          sortOrder: f.sortOrder ?? i,
        })),
      );
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: (next: Field[]) =>
      fetch(`${API_BASE}/api/admin/registration-templates/${templateId}/fields`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: next.map((f, i) => ({
            fieldKey: f.fieldKey,
            label: f.label,
            fieldType: f.fieldType,
            required: f.required,
            source: f.source,
            options: f.options,
            sortOrder: i,
          })),
        }),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Save failed");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/registration-templates", templateId] });
      qc.invalidateQueries({ queryKey: ["/api/registration-templates/active"] });
      toast({ title: "Fields saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const usedKeys = useMemo(() => new Set(fields.map((f) => f.fieldKey)), [fields]);
  const availableCoreFields = useMemo(
    () => coreFields.filter((cf) => !usedKeys.has(cf.fieldKey)),
    [coreFields, usedKeys],
  );

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...fields];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setFields(next);
  };

  const removeAt = (idx: number) => {
    setFields(fields.filter((_, i) => i !== idx));
  };

  const setRequired = (idx: number, value: boolean) => {
    const next = [...fields];
    next[idx] = { ...next[idx], required: value };
    setFields(next);
  };

  const addCoreField = (key: string) => {
    const def = coreFields.find((c) => c.fieldKey === key);
    if (!def) return;
    setFields([
      ...fields,
      {
        fieldKey: def.fieldKey,
        label: def.label,
        fieldType: def.fieldType,
        required: !!def.alwaysRequired,
        source: def.source,
        options: def.options ?? null,
        sortOrder: fields.length,
      },
    ]);
  };

  // ----- Add custom field inline form -----
  const [customLabel, setCustomLabel] = useState("");
  const [customType, setCustomType] = useState<Field["fieldType"]>("text");
  const [customRequired, setCustomRequired] = useState(false);
  const [customOptions, setCustomOptions] = useState("");

  const addCustom = () => {
    const label = customLabel.trim();
    if (!label) {
      toast({ title: "Label required", variant: "destructive" });
      return;
    }
    let key = slugify(label);
    if (!key) {
      toast({ title: "Label couldn't be turned into a key", variant: "destructive" });
      return;
    }
    // De-dupe locally so the user gets immediate feedback (server also enforces).
    let suffix = 1;
    while (usedKeys.has(key)) {
      suffix += 1;
      key = `${slugify(label)}_${suffix}`;
    }
    let options: Field["options"] = null;
    if (customType === "choice" || customType === "multichoice") {
      options = customOptions
        .split(/[\n,]/)
        .map((o) => o.trim())
        .filter(Boolean)
        .map((value) => ({ value: slugify(value) || value, label: value }));
      if (options.length === 0) {
        toast({ title: "Add at least one option for a choice field", variant: "destructive" });
        return;
      }
    }
    setFields([
      ...fields,
      {
        fieldKey: key,
        label,
        fieldType: customType,
        required: customRequired,
        source: "custom",
        options,
        sortOrder: fields.length,
      },
    ]);
    setCustomLabel("");
    setCustomType("text");
    setCustomRequired(false);
    setCustomOptions("");
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle>{data.template.name}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {data.template.countryCode ?? "Global"} · {fields.length} fields
            {data.template.isActive ? " · Active" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Back
          </Button>
          <Button onClick={() => saveMut.mutate(fields)} disabled={saveMut.isPending} className="gap-2" data-testid="save-template-fields">
            <Save className="h-4 w-4" />
            {saveMut.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Order</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="w-32">Required</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                    No fields yet. Add core fields below or add a custom one.
                  </TableCell>
                </TableRow>
              )}
              {fields.map((f, idx) => {
                const def = coreFields.find((c) => c.fieldKey === f.fieldKey);
                const lockedRequired = !!def?.alwaysRequired;
                return (
                  <TableRow key={f.fieldKey} data-testid={`field-row-${f.fieldKey}`}>
                    <TableCell>
                      <div className="flex flex-col">
                        <Button size="icon" variant="ghost" onClick={() => move(idx, -1)} disabled={idx === 0}>
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => move(idx, 1)} disabled={idx === fields.length - 1}>
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{f.label}</div>
                      <code className="text-xs text-muted-foreground">{f.fieldKey}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={f.source === "custom" ? "default" : "secondary"}>
                        {f.source === "custom" ? "Custom" : "Core"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{f.fieldType}</TableCell>
                    <TableCell>
                      <Switch
                        checked={f.required}
                        disabled={lockedRequired}
                        onCheckedChange={(v) => setRequired(idx, v)}
                        data-testid={`required-${f.fieldKey}`}
                      />
                      {lockedRequired && <p className="text-[10px] text-muted-foreground mt-1">Always required</p>}
                    </TableCell>
                    <TableCell className="text-right">
                      {f.source === "custom" && (
                        <Button size="icon" variant="ghost" onClick={() => removeAt(idx)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                      {f.source !== "custom" && !lockedRequired && (
                        <Button size="icon" variant="ghost" onClick={() => removeAt(idx)} title="Remove from template">
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {availableCoreFields.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs uppercase text-muted-foreground">Add a core field</Label>
            <div className="flex flex-wrap gap-2">
              {availableCoreFields.map((cf) => (
                <Button key={cf.fieldKey} size="sm" variant="outline" onClick={() => addCoreField(cf.fieldKey)} className="gap-1">
                  <Plus className="h-3 w-3" />
                  {cf.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="border rounded-md p-3 space-y-3 bg-muted/30">
          <Label className="text-xs uppercase text-muted-foreground">Add a custom field</Label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <Label>Label</Label>
              <Input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="e.g. Bank account number" data-testid="custom-label" />
              {customLabel && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Key: <code>{slugify(customLabel)}</code>
                </p>
              )}
            </div>
            <div>
              <Label>Type</Label>
              <Select value={customType} onValueChange={(v) => setCustomType(v as Field["fieldType"])}>
                <SelectTrigger data-testid="custom-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Switch checked={customRequired} onCheckedChange={setCustomRequired} id="custom-required" />
              <Label htmlFor="custom-required" className="mb-2">Required</Label>
            </div>
          </div>
          {(customType === "choice" || customType === "multichoice") && (
            <div>
              <Label>Options (comma- or newline-separated)</Label>
              <Textarea rows={2} value={customOptions} onChange={(e) => setCustomOptions(e.target.value)} placeholder="Yes, No, Sometimes" />
            </div>
          )}
          <Button size="sm" onClick={addCustom} className="gap-1" data-testid="add-custom-field">
            <Plus className="h-4 w-4" />
            Add field
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
