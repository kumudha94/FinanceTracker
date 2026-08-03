import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Building2, CreditCard, Trash2, Wallet, Eye, EyeOff } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { authenticatedFetch } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import type { Account, CardDetails } from "@shared/schema";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

const CARD_TYPES = [
  { value: 'visa', label: 'Visa' },
  { value: 'mastercard', label: 'Mastercard' },
  { value: 'rupay', label: 'RuPay' },
  { value: 'amex', label: 'American Express' },
  { value: 'other', label: 'Other' },
];

function CardDetailsDisplay({ accountId, onDelete }: { accountId: number; onDelete: (cardId: number, accountId: number) => void }) {
  const [showFull, setShowFull] = useState(false);
  
  const { data: card, isLoading } = useQuery<CardDetails & { cardNumber: string }>({
    queryKey: ["/api/accounts", accountId, "card"],
    queryFn: async () => {
      const response = await authenticatedFetch(`/api/accounts/${accountId}/card`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to fetch card');
      }
      return response.json();
    },
  });

  const { data: fullCard, refetch: fetchFullCard } = useQuery<CardDetails & { cardNumber: string }>({
    queryKey: ["/api/accounts", accountId, "card", "full"],
    queryFn: async () => {
      const response = await authenticatedFetch(`/api/accounts/${accountId}/card/full`);
      if (!response.ok) throw new Error('Failed to fetch card details');
      return response.json();
    },
    enabled: false,
  });

  const toggleShowFull = async () => {
    if (!showFull && !fullCard) {
      await fetchFullCard();
    }
    setShowFull(!showFull);
  };

  if (isLoading) return <div className="text-xs text-muted-foreground">Loading card...</div>;
  if (!card) return null;

  const formatCardNumber = (num: string) => {
    if (showFull && fullCard) {
      return fullCard.cardNumber.replace(/(.{4})/g, '$1 ').trim();
    }
    return card.cardNumber;
  };

  return (
    <div className="mt-2 pt-2 border-t flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Wallet className="w-4 h-4 text-muted-foreground" />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono">{formatCardNumber(card.cardNumber)}</span>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={toggleShowFull}
              data-testid={`button-toggle-card-${accountId}`}
            >
              {showFull ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {card.cardType?.toUpperCase()} {card.cardholderName ? `· ${card.cardholderName}` : ''} · Exp: {String(card.expiryMonth).padStart(2, '0')}/{card.expiryYear}
          </p>
        </div>
      </div>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => onDelete(card.id, accountId)}
        data-testid={`button-delete-card-${card.id}`}
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );
}

export default function Accounts() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCardDialogOpen, setIsCardDialogOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    type: "bank" as "bank" | "credit_card",
    bankName: "",
    accountNumber: "",
    balance: "",
    creditLimit: "",
    monthlySpendingLimit: "",
    billingDate: "",
  });
  const [cardFormData, setCardFormData] = useState({
    cardNumber: "",
    cardholderName: "",
    expiryMonth: "",
    expiryYear: "",
    cardType: "visa" as "visa" | "mastercard" | "rupay" | "amex" | "other",
  });
  const { toast } = useToast();

  const { data: accounts = [], isLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = {
        ...data,
        billingDate: data.billingDate ? parseInt(data.billingDate) : undefined,
      };
      const response = await apiRequest("POST", "/api/accounts", payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      setIsDialogOpen(false);
      setFormData({ name: "", type: "bank", bankName: "", accountNumber: "", balance: "", creditLimit: "", monthlySpendingLimit: "", billingDate: "" });
      toast({ title: "Account added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add account", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "Account deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete account", variant: "destructive" });
    },
  });

  const addCardMutation = useMutation({
    mutationFn: async (data: { accountId: number; cardData: typeof cardFormData }) => {
      const payload = {
        cardNumber: data.cardData.cardNumber.replace(/\s/g, ''),
        lastFourDigits: data.cardData.cardNumber.replace(/\s/g, '').slice(-4),
        cardholderName: data.cardData.cardholderName || undefined,
        expiryMonth: parseInt(data.cardData.expiryMonth),
        expiryYear: parseInt(data.cardData.expiryYear),
        cardType: data.cardData.cardType,
      };
      const response = await apiRequest("POST", `/api/accounts/${data.accountId}/card`, payload);
      return response.json();
    },
    onSuccess: () => {
      if (selectedAccountId) {
        queryClient.invalidateQueries({ queryKey: ["/api/accounts", selectedAccountId, "card"] });
      }
      setIsCardDialogOpen(false);
      setCardFormData({ cardNumber: "", cardholderName: "", expiryMonth: "", expiryYear: "", cardType: "visa" });
      setSelectedAccountId(null);
      toast({ title: "Card added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add card", variant: "destructive" });
    },
  });

  const deleteCardMutation = useMutation({
    mutationFn: async ({ cardId, accountId }: { cardId: number; accountId: number }) => {
      await apiRequest("DELETE", `/api/cards/${cardId}`);
      return { accountId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", data.accountId, "card"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", data.accountId, "card", "full"] });
      toast({ title: "Card deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete card", variant: "destructive" });
    },
  });

  const bankAccounts = accounts.filter(a => a.type === "bank");
  const creditCards = accounts.filter(a => a.type === "credit_card");

  const totalBalance = bankAccounts.reduce((sum, a) => sum + parseFloat(a.balance || "0"), 0);
  const totalCreditUsed = creditCards.reduce((sum, a) => {
    const balance = parseFloat(a.balance || "0");
    return sum + (balance < 0 ? Math.abs(balance) : 0);
  }, 0);
  const totalCreditLimit = creditCards.reduce((sum, a) => sum + parseFloat(a.creditLimit || "0"), 0);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-4 pb-24">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-foreground" data-testid="text-accounts-title">Accounts</h1>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-account">
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Account</DialogTitle>
              <DialogDescription>Add a new bank account or credit card to track</DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(formData); }} className="space-y-4">
              <div>
                <Label>Account Name</Label>
                <Input 
                  value={formData.name} 
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., HDFC Savings"
                  data-testid="input-account-name"
                />
              </div>
              <div>
                <Label>Type</Label>
                <Select value={formData.type} onValueChange={(v: "bank" | "credit_card") => setFormData({ ...formData, type: v })}>
                  <SelectTrigger data-testid="select-account-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank">Bank Account</SelectItem>
                    <SelectItem value="credit_card">Credit Card</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Bank Name</Label>
                <Input 
                  value={formData.bankName} 
                  onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                  placeholder="e.g., HDFC Bank"
                  data-testid="input-bank-name"
                />
              </div>
              <div>
                <Label>Account Number (last 4 digits)</Label>
                <Input 
                  value={formData.accountNumber} 
                  onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                  placeholder="e.g., 1234"
                  maxLength={4}
                  data-testid="input-account-number"
                />
              </div>
              <div>
                <Label>Current Balance</Label>
                <Input 
                  type="number" 
                  value={formData.balance} 
                  onChange={(e) => setFormData({ ...formData, balance: e.target.value })}
                  placeholder="0"
                  data-testid="input-balance"
                />
              </div>
              {formData.type === "credit_card" && (
                <>
                  <div>
                    <Label>Credit Limit</Label>
                    <Input 
                      type="number" 
                      value={formData.creditLimit} 
                      onChange={(e) => setFormData({ ...formData, creditLimit: e.target.value })}
                      placeholder="0"
                      data-testid="input-credit-limit"
                    />
                  </div>
                  <div>
                    <Label>Monthly Spending Limit (Optional)</Label>
                    <Input 
                      type="number" 
                      value={formData.monthlySpendingLimit} 
                      onChange={(e) => setFormData({ ...formData, monthlySpendingLimit: e.target.value })}
                      placeholder="e.g., 5000"
                      data-testid="input-monthly-spending-limit"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Set a monthly budget for this card</p>
                  </div>
                  <div>
                    <Label>Billing Date (Optional)</Label>
                    <Input 
                      type="number" 
                      min="1"
                      max="31"
                      value={formData.billingDate} 
                      onChange={(e) => setFormData({ ...formData, billingDate: e.target.value })}
                      placeholder="e.g., 13"
                      data-testid="input-billing-date"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Day of month when your billing cycle starts (1-31)</p>
                  </div>
                </>
              )}
              <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-save-account">
                {createMutation.isPending ? "Adding..." : "Add Account"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Balance</p>
            <p className="text-xl font-bold text-green-600">{formatCurrency(totalBalance)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Credit Used</p>
            <p className="text-xl font-bold text-destructive">{formatCurrency(totalCreditUsed)}</p>
            <p className="text-xs text-muted-foreground">of {formatCurrency(totalCreditLimit)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Bank Accounts */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
          <Building2 className="w-4 h-4" />
          Bank Accounts
        </h2>
        {bankAccounts.length > 0 ? (
          <div className="space-y-2">
            {bankAccounts.map((account) => (
              <Card key={account.id} data-testid={`card-account-${account.id}`}>
                <CardContent className="py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{account.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {account.bankName} {account.accountNumber ? `•• ${account.accountNumber}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-green-600">{formatCurrency(parseFloat(account.balance || "0"))}</p>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        onClick={() => deleteMutation.mutate(account.id)}
                        data-testid={`button-delete-account-${account.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <CardDetailsDisplay 
                    accountId={account.id} 
                    onDelete={(cardId, accountId) => deleteCardMutation.mutate({ cardId, accountId })} 
                  />
                  <div className="mt-2 pt-2 border-t">
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => {
                        setSelectedAccountId(account.id);
                        setIsCardDialogOpen(true);
                      }}
                      data-testid={`button-add-card-${account.id}`}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Add Debit Card
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground">
              No bank accounts added
            </CardContent>
          </Card>
        )}
      </div>

      {/* Credit Cards */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
          <CreditCard className="w-4 h-4" />
          Credit Cards
        </h2>
        {creditCards.length > 0 ? (
          <div className="space-y-2">
            {creditCards.map((card) => {
              const available = parseFloat(card.balance || "0"); // balance = available credit
              const limit = parseFloat(card.creditLimit || "0");
              const used = limit - available; // used = limit - available
              const usedPercent = limit > 0 ? (used / limit) * 100 : 0;
              
              return (
                <Card key={card.id} data-testid={`card-credit-${card.id}`}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div>
                        <p className="font-medium">{card.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {card.bankName} {card.accountNumber ? `•• ${card.accountNumber}` : ""}
                        </p>
                      </div>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMutation.mutate(card.id)}
                        data-testid={`button-delete-credit-${card.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Used: <span className="text-destructive font-medium">{formatCurrency(used)}</span></span>
                        <span className="text-muted-foreground">Available: <span className="text-green-600 font-medium">{formatCurrency(available)}</span></span>
                      </div>
                      <div className="h-2 bg-secondary rounded-full overflow-hidden mb-1">
                        <div 
                          className="h-full transition-all" 
                          style={{ 
                            width: `${Math.min(usedPercent, 100)}%`,
                            backgroundColor: usedPercent >= 90 ? '#ef4444' : usedPercent >= 70 ? '#f59e0b' : '#22c55e'
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-sm pt-1 border-t">
                        <span className="text-muted-foreground">Credit Limit:</span>
                        <span className="font-medium">{formatCurrency(limit)}</span>
                      </div>
                      {card.monthlySpendingLimit && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Monthly Spending Limit:</span>
                          <span className="font-medium text-primary">{formatCurrency(parseFloat(card.monthlySpendingLimit))}</span>
                        </div>
                      )}
                      {card.billingDate && (
                        <div className="text-xs text-muted-foreground pt-1">
                          Billing Date: {card.billingDate}th of every month
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground">
              No credit cards added
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add Card Dialog */}
      <Dialog open={isCardDialogOpen} onOpenChange={(open) => {
        setIsCardDialogOpen(open);
        if (!open) {
          setSelectedAccountId(null);
          setCardFormData({ cardNumber: "", cardholderName: "", expiryMonth: "", expiryYear: "", cardType: "visa" });
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Debit Card</DialogTitle>
            <DialogDescription>Store your debit card details securely. CVV is never stored.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (selectedAccountId) {
              addCardMutation.mutate({ accountId: selectedAccountId, cardData: cardFormData });
            }
          }} className="space-y-4">
            <div>
              <Label>Card Number</Label>
              <Input 
                value={cardFormData.cardNumber}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 16);
                  const formatted = value.replace(/(.{4})/g, '$1 ').trim();
                  setCardFormData({ ...cardFormData, cardNumber: formatted });
                }}
                placeholder="1234 5678 9012 3456"
                data-testid="input-card-number"
              />
            </div>
            <div>
              <Label>Cardholder Name</Label>
              <Input 
                value={cardFormData.cardholderName}
                onChange={(e) => setCardFormData({ ...cardFormData, cardholderName: e.target.value.toUpperCase() })}
                placeholder="JOHN DOE"
                data-testid="input-cardholder-name"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Expiry Month</Label>
                <Select value={cardFormData.expiryMonth} onValueChange={(v) => setCardFormData({ ...cardFormData, expiryMonth: v })}>
                  <SelectTrigger data-testid="select-expiry-month">
                    <SelectValue placeholder="MM" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                      <SelectItem key={m} value={String(m)}>{String(m).padStart(2, '0')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Expiry Year</Label>
                <Select value={cardFormData.expiryYear} onValueChange={(v) => setCardFormData({ ...cardFormData, expiryYear: v })}>
                  <SelectTrigger data-testid="select-expiry-year">
                    <SelectValue placeholder="YYYY" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() + i).map(y => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Card Type</Label>
                <Select value={cardFormData.cardType} onValueChange={(v: typeof cardFormData.cardType) => setCardFormData({ ...cardFormData, cardType: v })}>
                  <SelectTrigger data-testid="select-card-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CARD_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">For security, CVV is never stored. Card numbers are encrypted.</p>
            <Button 
              type="submit" 
              className="w-full" 
              disabled={addCardMutation.isPending || !cardFormData.cardNumber || !cardFormData.expiryMonth || !cardFormData.expiryYear}
              data-testid="button-save-card"
            >
              {addCardMutation.isPending ? "Adding..." : "Add Card"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
