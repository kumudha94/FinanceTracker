import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Plus, Trash2, Calendar, Bell, Check, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { ScheduledPayment, Category } from "@shared/schema";

interface PaymentOccurrence {
  id: number;
  scheduledPaymentId: number;
  month: number;
  year: number;
  dueDate: string;
  status: string;
  amount: string | null;
  paidAt: string | null;
  scheduledPayment?: ScheduledPayment;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function frequencyLabel(payment?: ScheduledPayment): string {
  if (payment?.frequency === "day_interval") {
    return `Every ${payment.customIntervalDays ?? "?"} Days`;
  }
  return FREQUENCY_OPTIONS.find(f => f.value === (payment?.frequency || "monthly"))?.label || "Monthly";
}

const FREQUENCY_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Every 3 Months" },
  { value: "half_yearly", label: "Every 6 Months" },
  { value: "yearly", label: "Yearly" },
  { value: "day_interval", label: "Every N Days" },
];

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function ScheduledPayments() {
  const [, setLocation] = useLocation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("checklist");
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [enteringAmountId, setEnteringAmountId] = useState<number | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const { toast } = useToast();
  
  const [formData, setFormData] = useState({
    name: "",
    amount: "",
    variableAmount: false,
    dueDate: 1,
    categoryId: "",
    frequency: "monthly",
    startMonth: new Date().getMonth() + 1,
    customIntervalDays: 30,
    lastPaidDate: new Date().toISOString().slice(0, 10),
    notes: "",
    status: "active" as "active" | "inactive",
  });

  const { data: payments = [], isLoading } = useQuery<ScheduledPayment[]>({
    queryKey: ["/api/scheduled-payments"],
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: occurrences = [], refetch: refetchOccurrences } = useQuery<PaymentOccurrence[]>({
    queryKey: ["/api/payment-occurrences", currentMonth, currentYear],
    queryFn: async () => {
      const res = await fetch(`/api/payment-occurrences?month=${currentMonth}&year=${currentYear}`);
      return res.json();
    },
  });

  const generateOccurrencesMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/payment-occurrences/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: currentMonth, year: currentYear }),
      });
      return res.json();
    },
    onSuccess: () => {
      refetchOccurrences();
    },
  });

  useEffect(() => {
    // Always call this (not just when occurrences.length === 0) — a day-interval payment can
    // put an occurrence in this month on its own (created when its previous cycle was paid),
    // which would otherwise make this look "already generated" and skip other payments still
    // due this month. The backend already dedupes per-payment, so repeat calls are safe.
    if (payments.length > 0) {
      generateOccurrencesMutation.mutate();
    }
  }, [payments, currentMonth, currentYear]);

  const updateOccurrenceMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetch(`/api/payment-occurrences/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      refetchOccurrences();
      toast({ title: variables.status === "paid" ? "Marked as paid!" : "Status updated" });
    },
  });

  const setOccurrenceAmountMutation = useMutation({
    mutationFn: async ({ id, amount }: { id: number; amount: string }) => {
      const res = await fetch(`/api/payment-occurrences/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      return res.json();
    },
    onSuccess: () => {
      refetchOccurrences();
      setEnteringAmountId(null);
      setAmountInput("");
      toast({ title: "Amount saved" });
    },
    onError: () => toast({ title: "Failed to save amount", variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await apiRequest("POST", "/api/scheduled-payments", {
        ...data,
        categoryId: data.categoryId ? parseInt(data.categoryId) : null,
        startMonth: data.frequency !== "monthly" && data.frequency !== "day_interval" ? data.startMonth : null,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      refetchOccurrences();
      generateOccurrencesMutation.mutate();
      setIsDialogOpen(false);
      setFormData({
        name: "", amount: "", variableAmount: false, dueDate: 1, categoryId: "", frequency: "monthly",
        startMonth: new Date().getMonth() + 1, customIntervalDays: 30, lastPaidDate: new Date().toISOString().slice(0, 10),
        notes: "", status: "active",
      });
      toast({ title: "Payment added" });
    },
    onError: () => {
      toast({ title: "Failed to add payment", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await apiRequest("PATCH", `/api/scheduled-payments/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Payment status updated" });
    },
    onError: () => {
      toast({ title: "Failed to update payment", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/scheduled-payments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      refetchOccurrences();
      toast({ title: "Payment deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete payment", variant: "destructive" });
    },
  });

  const goToPreviousMonth = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const activePayments = payments.filter(p => p.status === "active");
  const totalMonthly = activePayments.reduce((sum, p) => sum + parseFloat(p.amount || "0"), 0);

  const occurrenceAmount = (o: PaymentOccurrence) => parseFloat(o.amount ?? o.scheduledPayment?.amount ?? "0");
  const paidOccurrences = occurrences.filter(o => o.status === "paid");
  const pendingOccurrences = occurrences.filter(o => o.status === "pending");
  const totalPaid = paidOccurrences.reduce((sum, o) => sum + occurrenceAmount(o), 0);
  const totalPending = pendingOccurrences.reduce((sum, o) => sum + occurrenceAmount(o), 0);

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
      <div className="flex items-center justify-between gap-2 p-4 border-b">
        <div className="flex items-center gap-3">
          <Button size="icon" variant="ghost" onClick={() => setLocation("/more")} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">s</h1>
            <p className="text-xs text-muted-foreground">{activePayments.length} active payments</p>
          </div>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-payment">
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Scheduled Payment</DialogTitle>
              <DialogDescription>Set up a recurring payment reminder</DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(formData); }} className="space-y-4">
              <div>
                <Label>Payment Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Maid Salary, Netflix, Water Tax"
                  data-testid="input-payment-name"
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label>This bill's amount varies each time</Label>
                  <p className="text-xs text-muted-foreground">e.g. electricity — you'll enter the actual amount each cycle</p>
                </div>
                <Switch
                  checked={formData.variableAmount}
                  onCheckedChange={(checked) => setFormData({ ...formData, variableAmount: checked, amount: checked ? "" : formData.amount })}
                  data-testid="switch-variable-amount"
                />
              </div>
              {!formData.variableAmount && (
                <div>
                  <Label>Amount (INR)</Label>
                  <Input
                    type="number"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    placeholder="e.g., 2000"
                    data-testid="input-payment-amount"
                  />
                </div>
              )}
              <div>
                <Label>Frequency</Label>
                <Select value={formData.frequency} onValueChange={(v) => setFormData({ ...formData, frequency: v })}>
                  <SelectTrigger data-testid="select-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {formData.frequency !== "monthly" && formData.frequency !== "day_interval" && (
                <div>
                  <Label>Starting Month</Label>
                  <Select value={formData.startMonth.toString()} onValueChange={(v) => setFormData({ ...formData, startMonth: parseInt(v) })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTH_NAMES.map((name, i) => (
                        <SelectItem key={i + 1} value={(i + 1).toString()}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {formData.frequency === "day_interval" ? (
                <>
                  <div>
                    <Label>Interval (days)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={formData.customIntervalDays}
                      onChange={(e) => setFormData({ ...formData, customIntervalDays: parseInt(e.target.value) || 1 })}
                      placeholder="e.g., 84"
                      data-testid="input-interval-days"
                    />
                  </div>
                  <div>
                    <Label>Last recharged/paid on</Label>
                    <Input
                      type="date"
                      value={formData.lastPaidDate}
                      onChange={(e) => setFormData({ ...formData, lastPaidDate: e.target.value })}
                      data-testid="input-last-paid-date"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Next due date will be {formData.customIntervalDays} days after this
                    </p>
                  </div>
                </>
              ) : (
                <div>
                  <Label>Due Date (Day of Month)</Label>
                  <Select value={formData.dueDate.toString()} onValueChange={(v) => setFormData({ ...formData, dueDate: parseInt(v) })}>
                    <SelectTrigger data-testid="select-due-date">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                        <SelectItem key={day} value={day.toString()}>{day}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>Category (Optional)</Label>
                <Select value={formData.categoryId} onValueChange={(v) => setFormData({ ...formData, categoryId: v })}>
                  <SelectTrigger data-testid="select-payment-category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.filter(c => c.type === "expense").map((cat) => (
                      <SelectItem key={cat.id} value={cat.id.toString()}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes (Optional)</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Any additional notes"
                  rows={2}
                  data-testid="input-payment-notes"
                />
              </div>
              <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-save-payment">
                {createMutation.isPending ? "Saving..." : "Add Payment"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
        <TabsList className="w-full justify-start px-4 pt-2">
          <TabsTrigger value="checklist" className="flex-1">This Month</TabsTrigger>
          <TabsTrigger value="manage" className="flex-1">All Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="checklist" className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={goToPreviousMonth}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <h2 className="font-semibold">{MONTH_NAMES[currentMonth - 1]} {currentYear}</h2>
            <Button variant="ghost" size="icon" onClick={goToNextMonth}>
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Card className="bg-green-50 dark:bg-green-950/30 border-green-200">
              <CardContent className="py-3 text-center">
                <p className="text-xs text-muted-foreground">Paid</p>
                <p className="text-lg font-bold text-green-600">{formatCurrency(totalPaid)}</p>
                <p className="text-xs text-muted-foreground">{paidOccurrences.length} items</p>
              </CardContent>
            </Card>
            <Card className="bg-orange-50 dark:bg-orange-950/30 border-orange-200">
              <CardContent className="py-3 text-center">
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-lg font-bold text-orange-600">{formatCurrency(totalPending)}</p>
                <p className="text-xs text-muted-foreground">{pendingOccurrences.length} items</p>
              </CardContent>
            </Card>
          </div>

          {occurrences.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No payments due this month</p>
                <Button 
                  variant="outline" 
                  className="mt-4"
                  onClick={() => generateOccurrencesMutation.mutate()}
                >
                  Generate Checklist
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {occurrences.map((occurrence) => {
                const payment = occurrence.scheduledPayment;
                const isPaid = occurrence.status === "paid";
                const category = categories.find(c => c.id === payment?.categoryId);
                const dueDate = new Date(occurrence.dueDate);
                const isPastDue = !isPaid && dueDate < new Date();
                const effectiveAmount = occurrence.amount ?? payment?.amount ?? null;
                const needsAmount = !!payment?.variableAmount && !effectiveAmount;
                const isEnteringAmount = enteringAmountId === occurrence.id;

                return (
                  <Card
                    key={occurrence.id}
                    className={`transition-all ${isPaid ? "opacity-60 bg-muted/30" : isPastDue ? "border-red-500/50" : ""}`}
                  >
                    <CardContent className="py-3">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={isPaid}
                          disabled={needsAmount}
                          onCheckedChange={(checked) => {
                            updateOccurrenceMutation.mutate({
                              id: occurrence.id,
                              status: checked ? "paid" : "pending",
                            });
                          }}
                          className="h-6 w-6"
                        />
                        <div
                          className="flex-1 cursor-pointer"
                          onClick={() => {
                            if (needsAmount && !isEnteringAmount) {
                              setEnteringAmountId(occurrence.id);
                              setAmountInput("");
                            }
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <p className={`font-medium ${isPaid ? "line-through text-muted-foreground" : ""}`}>
                              {payment?.name}
                            </p>
                            {isPastDue && <Badge variant="destructive" className="text-xs">Overdue</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Due {format(dueDate, "d MMM")}
                            {category && ` • ${category.name}`}
                            {payment?.frequency && payment.frequency !== "monthly" && (
                              <span className="ml-1 text-primary">
                                • {frequencyLabel(payment)}
                              </span>
                            )}
                          </p>
                          {isEnteringAmount && (
                            <div className="flex items-center gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                              <Input
                                type="number"
                                autoFocus
                                value={amountInput}
                                onChange={(e) => setAmountInput(e.target.value)}
                                placeholder="This cycle's amount"
                                className="h-8"
                                data-testid={`input-occurrence-amount-${occurrence.id}`}
                              />
                              <Button
                                size="sm"
                                disabled={!amountInput || setOccurrenceAmountMutation.isPending}
                                onClick={() => setOccurrenceAmountMutation.mutate({ id: occurrence.id, amount: amountInput })}
                                data-testid={`button-save-occurrence-amount-${occurrence.id}`}
                              >
                                Save
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEnteringAmountId(null)}>Cancel</Button>
                            </div>
                          )}
                        </div>
                        {needsAmount ? (
                          !isEnteringAmount && (
                            <Badge variant="outline" className="text-xs">Enter amount</Badge>
                          )
                        ) : (
                          <p className={`font-semibold ${isPaid ? "text-muted-foreground" : "text-destructive"}`}>
                            {formatCurrency(parseFloat(effectiveAmount || "0"))}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="manage" className="p-4 space-y-4">
          <Card className="bg-gradient-to-r from-orange-500 to-red-500 text-white">
            <CardContent className="py-4">
              <p className="text-sm opacity-90">Total Monthly Commitment</p>
              <p className="text-2xl font-bold">{formatCurrency(totalMonthly)}</p>
            </CardContent>
          </Card>

          {payments.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-4">No scheduled payments yet</p>
                <Button onClick={() => setIsDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Your First Payment
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {payments.map((payment) => {
                const category = categories.find(c => c.id === payment.categoryId);
                const isActive = payment.status === "active";

                return (
                  <Card key={payment.id} className={!isActive ? "opacity-60" : ""}>
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium">{payment.name}</p>
                            <Badge variant="secondary" className="text-xs">
                              {frequencyLabel(payment)}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            <Calendar className="w-3 h-3 inline mr-1" />
                            {payment.frequency === "day_interval" ? frequencyLabel(payment) : `Due on ${payment.dueDate}th`}
                            {category && ` • ${category.name}`}
                          </p>
                          {payment.notes && (
                            <p className="text-xs text-muted-foreground mt-1">{payment.notes}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">
                            {payment.amount ? formatCurrency(parseFloat(payment.amount)) : (
                              <span className="text-xs text-muted-foreground font-normal">Amount varies</span>
                            )}
                          </p>
                          <div className="flex flex-col items-center gap-1">
                            <Switch
                              checked={isActive}
                              onCheckedChange={(checked) => updateMutation.mutate({ id: payment.id, status: checked ? "active" : "inactive" })}
                            />
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              onClick={() => deleteMutation.mutate(payment.id)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
