import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Inbox, Link2, Plus, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { ScheduledPayment } from "@shared/schema";

interface PendingBillMapping {
  id: number;
  institutionKey: string;
  suggestedName: string | null;
  latestAmount: number | null;
  latestDueDate: string | null;
  latestReceivedAt: string | null;
  latestMessage: string | null;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function BillsInbox() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [selectedScheduledPaymentId, setSelectedScheduledPaymentId] = useState<string>("");
  const [creatingForId, setCreatingForId] = useState<number | null>(null);
  const [newPaymentName, setNewPaymentName] = useState("");
  const [newPaymentAmount, setNewPaymentAmount] = useState("");
  const [newPaymentDueDate, setNewPaymentDueDate] = useState(1);

  const { data: mappings = [], isLoading } = useQuery<PendingBillMapping[]>({
    queryKey: ["/api/bill-mappings/pending"],
  });

  const { data: scheduledPayments = [] } = useQuery<ScheduledPayment[]>({
    queryKey: ["/api/scheduled-payments"],
  });

  const invalidateInbox = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/bill-mappings/pending"] });
  };

  const linkMutation = useMutation({
    mutationFn: async ({ id, scheduledPaymentId }: { id: number; scheduledPaymentId: number }) => {
      const res = await apiRequest("POST", `/api/bill-mappings/${id}/link`, { scheduledPaymentId });
      return res.json();
    },
    onSuccess: () => {
      invalidateInbox();
      setLinkingId(null);
      setSelectedScheduledPaymentId("");
      toast({ title: "Linked — future SMS from this sender will auto-confirm" });
    },
    onError: () => toast({ title: "Failed to link", variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async ({ id, name, amount, dueDate }: { id: number; name: string; amount: string; dueDate: number }) => {
      const res = await apiRequest("POST", `/api/bill-mappings/${id}/create-scheduled-payment`, {
        name,
        amount,
        dueDateType: "fixed_day",
        dueDate,
        frequency: "monthly",
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateInbox();
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-payments"] });
      setCreatingForId(null);
      setNewPaymentName("");
      setNewPaymentAmount("");
      toast({ title: "Scheduled payment created and linked" });
    },
    onError: () => toast({ title: "Failed to create scheduled payment", variant: "destructive" }),
  });

  const ignoreMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/bill-mappings/${id}/ignore`, {});
      return res.json();
    },
    onSuccess: () => {
      invalidateInbox();
      toast({ title: "Dismissed — you won't be asked about this sender again" });
    },
    onError: () => toast({ title: "Failed to dismiss", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-4 pb-24">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <div className="flex items-center gap-3 p-4 border-b">
        <Button size="icon" variant="ghost" onClick={() => setLocation("/more")} data-testid="button-back">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-lg font-semibold">Bills Inbox</h1>
          <p className="text-xs text-muted-foreground">{mappings.length} sender{mappings.length === 1 ? "" : "s"} need triage</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4 pb-24">
        {mappings.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <Inbox className="w-10 h-10" />
            <p>No bills waiting for triage</p>
            <p className="text-xs">Due-reminder SMS that can't be matched to a credit card will show up here.</p>
          </div>
        )}

        {mappings.map((mapping) => (
          <Card key={mapping.id} data-testid={`card-bill-mapping-${mapping.id}`}>
            <CardContent className="pt-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{mapping.suggestedName || mapping.institutionKey}</p>
                  <p className="text-xs text-muted-foreground">{mapping.institutionKey}</p>
                </div>
                {mapping.latestAmount !== null && (
                  <Badge variant="secondary">{formatCurrency(mapping.latestAmount)}</Badge>
                )}
              </div>

              {mapping.latestMessage && (
                <p className="text-sm text-muted-foreground line-clamp-2">{mapping.latestMessage}</p>
              )}

              {mapping.latestDueDate && (
                <p className="text-xs text-muted-foreground">
                  Due {format(new Date(mapping.latestDueDate), "d MMM yyyy")}
                </p>
              )}

              {linkingId === mapping.id ? (
                <div className="flex flex-col gap-2">
                  <Select value={selectedScheduledPaymentId} onValueChange={setSelectedScheduledPaymentId}>
                    <SelectTrigger data-testid={`select-scheduled-payment-${mapping.id}`}>
                      <SelectValue placeholder="Choose a scheduled payment" />
                    </SelectTrigger>
                    <SelectContent>
                      {scheduledPayments.map((sp) => (
                        <SelectItem key={sp.id} value={String(sp.id)}>{sp.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={!selectedScheduledPaymentId || linkMutation.isPending}
                      onClick={() => linkMutation.mutate({ id: mapping.id, scheduledPaymentId: Number(selectedScheduledPaymentId) })}
                      data-testid={`button-confirm-link-${mapping.id}`}
                    >
                      Link
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setLinkingId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : creatingForId === mapping.id ? (
                <div className="flex flex-col gap-2">
                  <Input
                    placeholder="Bill name, e.g. Jio Recharge"
                    value={newPaymentName}
                    onChange={(e) => setNewPaymentName(e.target.value)}
                    data-testid={`input-new-payment-name-${mapping.id}`}
                  />
                  <Input
                    type="number"
                    placeholder="Amount"
                    value={newPaymentAmount}
                    onChange={(e) => setNewPaymentAmount(e.target.value)}
                    data-testid={`input-new-payment-amount-${mapping.id}`}
                  />
                  <div>
                    <Label className="text-xs">Due day of month</Label>
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      value={newPaymentDueDate}
                      onChange={(e) => setNewPaymentDueDate(Number(e.target.value))}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={!newPaymentName || !newPaymentAmount || createMutation.isPending}
                      onClick={() => createMutation.mutate({ id: mapping.id, name: newPaymentName, amount: newPaymentAmount, dueDate: newPaymentDueDate })}
                      data-testid={`button-confirm-create-${mapping.id}`}
                    >
                      Create & Link
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCreatingForId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setLinkingId(mapping.id)}
                    data-testid={`button-link-${mapping.id}`}
                  >
                    <Link2 className="w-4 h-4 mr-1" /> Link existing
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCreatingForId(mapping.id);
                      setNewPaymentName(mapping.suggestedName || "");
                      setNewPaymentAmount(mapping.latestAmount ? String(mapping.latestAmount) : "");
                    }}
                    data-testid={`button-create-${mapping.id}`}
                  >
                    <Plus className="w-4 h-4 mr-1" /> New payment
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => ignoreMutation.mutate(mapping.id)}
                    disabled={ignoreMutation.isPending}
                    data-testid={`button-ignore-${mapping.id}`}
                  >
                    <X className="w-4 h-4 mr-1" /> Dismiss
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
