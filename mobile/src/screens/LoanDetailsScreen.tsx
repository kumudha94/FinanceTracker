import { useState, useMemo, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal, TextInput, Alert, Animated, Switch, Platform } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { formatCurrency, getThemedColors } from '../lib/utils';
import { api } from '../lib/api';
import { useTheme } from '../contexts/ThemeContext';
import type { Loan, LoanInstallment, LoanTerm, LoanPayment, LoanBtAllocation } from '../lib/types';
import DateTimePicker from '@react-native-community/datetimepicker';
import SpendingBreakdownModal from '../components/SpendingBreakdownModal';

type RouteParams = {
  LoanDetails: {
    loanId: number;
  };
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function LoanDetailsScreen() {
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RouteParams, 'LoanDetails'>>();
  const queryClient = useQueryClient();
  const { loanId } = route.params;

  const [activeTab, setActiveTab] = useState<'upcoming' | 'payments' | 'terms' | 'bt'>('upcoming');
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [regenerateModalVisible, setRegenerateModalVisible] = useState(false);
  const [preclosureModalVisible, setPreclosureModalVisible] = useState(false);
  const [topupModalVisible, setTopupModalVisible] = useState(false);
  const [spendingBreakdownVisible, setSpendingBreakdownVisible] = useState(false);
  const [addTermModalVisible, setAddTermModalVisible] = useState(false);
  const [addPaymentModalVisible, setAddPaymentModalVisible] = useState(false);
  const [editPaymentModalVisible, setEditPaymentModalVisible] = useState(false);
  const [editingPayment, setEditingPayment] = useState<LoanPayment | null>(null);
  const [processingInstallmentId, setProcessingInstallmentId] = useState<number | null>(null);
  const [newTerm, setNewTerm] = useState({ interestRate: '', tenureMonths: '', emiAmount: '', reason: '' });
  const [newPayment, setNewPayment] = useState({ amount: '', principalPaid: '', interestPaid: '', paymentType: 'emi' as 'emi' | 'prepayment' | 'partial', notes: '' });
  const [editPayment, setEditPayment] = useState({ amount: '', principalPaid: '', interestPaid: '', paymentType: 'emi' as 'emi' | 'prepayment' | 'partial', notes: '' });
  const [preclosureAmount, setPreclosureAmount] = useState('');
  const [preclosureDate, setPreclosureDate] = useState(new Date());
  const [showPreclosureDatePicker, setShowPreclosureDatePicker] = useState(false);
  
  // Part Payment state
  const [partPaymentModalVisible, setPartPaymentModalVisible] = useState(false);
  const [partPaymentAmount, setPartPaymentAmount] = useState('');
  const [partPaymentDate, setPartPaymentDate] = useState(new Date());
  const [showPartPaymentDatePicker, setShowPartPaymentDatePicker] = useState(false);
  const [partPaymentEffect, setPartPaymentEffect] = useState<'reduce_emi' | 'reduce_tenure'>('reduce_tenure');
  const [payEmiModalVisible, setPayEmiModalVisible] = useState(false);
  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [payEmiCreateTransaction, setPayEmiCreateTransaction] = useState(false);
  const [payEmiAffectBalance, setPayEmiAffectBalance] = useState(false);
  const [topupData, setTopupData] = useState({ 
    topupAmount: '', 
    newEmiAmount: '', 
    additionalTenure: '',
    notes: '' 
  });
  
  // BT related state
  const [btPaymentModalVisible, setBtPaymentModalVisible] = useState(false);
  const [selectedBtAllocation, setSelectedBtAllocation] = useState<LoanBtAllocation | null>(null);
  const [btPaymentDate, setBtPaymentDate] = useState(new Date());
  const [showBtDatePicker, setShowBtDatePicker] = useState(false);
  const [btPaymentAmount, setBtPaymentAmount] = useState('');
  const [btProcessingFee, setBtProcessingFee] = useState('');

  const { data: loan, isLoading } = useQuery<Loan>({
    queryKey: ['/api/loans', loanId],
    queryFn: () => api.getLoan(loanId),
  });

  const { data: installments = [] } = useQuery<LoanInstallment[]>({
    queryKey: ['loan-installments', loanId],
    queryFn: () => api.getLoanInstallments(loanId),
    enabled: !!loan,
  });

  const { data: terms = [] } = useQuery<LoanTerm[]>({
    queryKey: ['loan-terms', loanId],
    queryFn: () => api.getLoanTerms(loanId),
    enabled: !!loan,
  });

  const { data: payments = [] } = useQuery<LoanPayment[]>({
    queryKey: ['loan-payments', loanId],
    queryFn: () => api.getLoanPayments(loanId),
    enabled: !!loan,
  });

  // BT allocations for this loan as source (outgoing BTs)
  const { data: btAllocations = [], refetch: refetchBtAllocations } = useQuery<LoanBtAllocation[]>({
    queryKey: ['loan-bt-allocations', loanId],
    queryFn: () => api.getLoanBtAllocations(loanId),
    enabled: !!loan && loan.includesBtClosure,
  });

  // BT allocations for this loan as target (if closed via BT)
  const { data: btAsTarget = [] } = useQuery<LoanBtAllocation[]>({
    queryKey: ['loan-bt-as-target', loanId],
    queryFn: () => api.getLoanBtAllocationsAsTarget(loanId),
    enabled: !!loan,
  });

  // Get source loan name if this loan was closed via BT
  const { data: sourceLoan } = useQuery<Loan>({
    queryKey: ['/api/loans', loan?.closedViaBtFromLoanId],
    queryFn: () => api.getLoan(loan!.closedViaBtFromLoanId!),
    enabled: !!loan?.closedViaBtFromLoanId,
  });

  // Get all loans for displaying target loan names in BT tab
  const { data: allLoans = [] } = useQuery<Loan[]>({
    queryKey: ['/api/loans'],
    queryFn: () => api.getLoans(),
    enabled: !!loan && (loan.includesBtClosure || btAsTarget.length > 0),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteLoan(loanId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/loan-summary'] });
      Toast.show({
        type: 'success',
        text1: 'Loan Deleted',
        text2: 'The loan has been deleted successfully',
        position: 'bottom',
      });
      navigation.goBack();
    },
    onError: (error: any) => {
      Toast.show({
        type: 'error',
        text1: 'Delete Failed',
        text2: error.message || 'Could not delete loan',
        position: 'bottom',
      });
    },
  });

  const precloseMutation = useMutation({
    mutationFn: (data: { closureAmount: string; closureDate: string; accountId?: number; createTransaction?: boolean }) => 
      api.precloseLoan(loanId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/loans', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-installments', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-payments', loanId] });
      queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/loan-summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      setPreclosureModalVisible(false);
      setPreclosureAmount('');
      Toast.show({
        type: 'success',
        text1: 'Loan Pre-Closed',
        text2: 'The loan has been successfully pre-closed',
        position: 'bottom',
      });
    },
    onError: (error: any) => {
      Toast.show({
        type: 'error',
        text1: 'Pre-Closure Failed',
        text2: error.message || 'Could not pre-close loan',
        position: 'bottom',
      });
    },
  });

  const topupMutation = useMutation({
    mutationFn: (data: { topupAmount: string; newEmiAmount?: string; additionalTenure?: number; accountId?: number; createTransaction?: boolean; notes?: string }) => 
      api.topupLoan(loanId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/loans', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-installments', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-terms', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-payments', loanId] });
      queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/loan-summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      setTopupModalVisible(false);
      setTopupData({ topupAmount: '', newEmiAmount: '', additionalTenure: '', notes: '' });
      Toast.show({
        type: 'success',
        text1: 'Loan Topped Up',
        text2: 'Additional principal has been added to your loan',
        position: 'bottom',
      });
    },
    onError: (error: any) => {
      Toast.show({
        type: 'error',
        text1: 'Top-Up Failed',
        text2: error.message || 'Could not top-up loan',
        position: 'bottom',
      });
    },
  });

  const partPaymentMutation = useMutation({
    mutationFn: (data: { amount: string; paymentDate: string; effect: 'reduce_emi' | 'reduce_tenure'; accountId?: number; createTransaction?: boolean }) => 
      api.makePartPayment(loanId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/loans', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-installments', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-terms', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-payments', loanId] });
      queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/loan-summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      setPartPaymentModalVisible(false);
      setPartPaymentAmount('');
      Toast.show({
        type: 'success',
        text1: 'Part Payment Successful',
        text2: 'Outstanding balance has been reduced',
        position: 'bottom',
      });
    },
    onError: (error: any) => {
      Toast.show({
        type: 'error',
        text1: 'Part Payment Failed',
        text2: error.message || 'Could not process part payment',
        position: 'bottom',
      });
    },
  });

  const regenerateInstallmentsMutation = useMutation({
    mutationFn: () => {
      console.log('Regenerating installments for loan:', loanId);
      return api.regenerateInstallments(loanId);
    },
    onSuccess: (data) => {
      console.log('Regeneration successful:', data);
      queryClient.invalidateQueries({ queryKey: ['loan-installments', loanId] });
      queryClient.invalidateQueries({ queryKey: ['/api/loans', loanId] });
      queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/loan-summary'] });
      Toast.show({
        type: 'success',
        text1: 'Installments Regenerated',
        text2: 'Pending installments have been recalculated',
        position: 'bottom',
      });
    },
    onError: (error: any) => {
      console.error('Regeneration error:', error);
      Toast.show({
        type: 'error',
        text1: 'Regeneration Failed',
        text2: error.message || 'Could not regenerate installments',
        position: 'bottom',
      });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async ({ installmentId, amount, createTransaction, affectBalance }: { installmentId: number; amount: string; createTransaction: boolean; affectBalance: boolean }) => {
      setProcessingInstallmentId(installmentId);      
      return api.markInstallmentPaid(loanId, installmentId, {
        paidDate: new Date().toISOString().split('T')[0],
        paidAmount: amount,
        accountId: loan?.accountId || undefined,
        createTransaction,
        affectBalance,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/loans', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-installments', loanId] });
      queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/loan-summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      setProcessingInstallmentId(null);
      setPayEmiModalVisible(false);
      setSelectedInstallment(null);
      Toast.show({
        type: 'success',
        text1: 'EMI Marked as Paid',
        text2: 'The installment has been marked as paid',
        position: 'bottom',
      });
    },
    onError: (error: any) => {
      setProcessingInstallmentId(null);
      Toast.show({
        type: 'error',
        text1: 'Payment Failed',
        text2: error.message || 'Could not mark as paid',
        position: 'bottom',
      });
    },
  });

  const addTermMutation = useMutation({
    mutationFn: async (data: { interestRate: string; tenureMonths: string; emiAmount: string; reason: string }) => {
      return api.createLoanTerm(loanId, {
        effectiveFrom: new Date().toISOString().split('T')[0],
        interestRate: data.interestRate,
        tenureMonths: parseInt(data.tenureMonths),
        emiAmount: data.emiAmount,
        outstandingAtChange: loan?.outstandingAmount || '0',
        reason: data.reason || undefined,
        notes: undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan-terms', loanId] });
      queryClient.invalidateQueries({ queryKey: ['/api/loans', loanId] });
      setAddTermModalVisible(false);
      setNewTerm({ interestRate: '', tenureMonths: '', emiAmount: '', reason: '' });
      Toast.show({
        type: 'success',
        text1: 'Term Added',
        text2: 'New loan term has been recorded',
        position: 'bottom',
      });
    },
    onError: (error: any) => {
      Toast.show({
        type: 'error',
        text1: 'Failed',
        text2: error.message || 'Could not add term',
        position: 'bottom',
      });
    },
  });

  const addPaymentMutation = useMutation({
    mutationFn: async (data: { amount: string; principalPaid: string; interestPaid: string; paymentType: string; notes: string }) => {
      return api.createLoanPayment(loanId, {
        paymentDate: new Date().toISOString().split('T')[0],
        amount: data.amount,
        principalPaid: data.principalPaid || '0',
        interestPaid: data.interestPaid || '0',
        paymentType: data.paymentType as 'emi' | 'prepayment' | 'partial',
        notes: data.notes || undefined,
        installmentId: undefined,
        accountId: undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan-payments', loanId] });
      queryClient.invalidateQueries({ queryKey: ['/api/loans', loanId] });
      queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/loan-summary'] });
      setAddPaymentModalVisible(false);
      setNewPayment({ amount: '', principalPaid: '', interestPaid: '', paymentType: 'emi', notes: '' });
      Toast.show({
        type: 'success',
        text1: 'Payment Recorded',
        text2: 'Payment has been added to history',
        position: 'bottom',
      });
    },
    onError: (error: any) => {
      Toast.show({
        type: 'error',
        text1: 'Failed',
        text2: error.message || 'Could not record payment',
        position: 'bottom',
      });
    },
  });

  const updatePaymentMutation = useMutation({
    mutationFn: async (data: { id: number; amount: string; principalPaid: string; interestPaid: string; paymentType: string; notes: string }) => {
      return api.updateLoanPayment(data.id, {
        amount: data.amount,
        principalPaid: data.principalPaid || '0',
        interestPaid: data.interestPaid || '0',
        paymentType: data.paymentType as 'emi' | 'prepayment' | 'partial',
        notes: data.notes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan-payments', loanId] });
      queryClient.invalidateQueries({ queryKey: ['/api/loans', loanId] });
      queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/loan-summary'] });
      setEditPaymentModalVisible(false);
      setEditingPayment(null);
      Toast.show({
        type: 'success',
        text1: 'Payment Updated',
        text2: 'Payment has been updated successfully',
        position: 'bottom',
      });
    },
    onError: (error: any) => {
      Toast.show({
        type: 'error',
        text1: 'Failed',
        text2: error.message || 'Could not update payment',
        position: 'bottom',
      });
    },
  });

  const deletePaymentMutation = useMutation({
    mutationFn: (paymentId: number) => api.deleteLoanPayment(paymentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan-payments', loanId] });
      queryClient.invalidateQueries({ queryKey: ['/api/loans', loanId] });
      queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/loan-summary'] });
      Toast.show({
        type: 'success',
        text1: 'Payment Deleted',
        text2: 'Payment has been removed and balance updated',
        position: 'bottom',
      });
    },
    onError: (error: any) => {
      Toast.show({
        type: 'error',
        text1: 'Delete Failed',
        text2: error.message || 'Could not delete payment',
        position: 'bottom',
      });
    },
  });

  // BT Payment mutation
  const btPaymentMutation = useMutation({
    mutationFn: async ({ allocationId, actualBtAmount, processedDate, processingFee }: { allocationId: number; actualBtAmount: string; processedDate: string; processingFee?: string }) => {
      return api.processBtPayment(allocationId, { actualBtAmount, processedDate, processingFee });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
      queryClient.invalidateQueries({ queryKey: ['loan-bt-allocations', loanId] });
      refetchBtAllocations();
      
      const isFullClosure = result.targetLoan.status === 'closed_bt';
      Toast.show({
        type: 'success',
        text1: 'BT Payment Processed',
        text2: isFullClosure ? 'Target loan has been closed' : 'Target loan outstanding reduced',
        position: 'bottom',
      });
      
      setBtPaymentModalVisible(false);
      setSelectedBtAllocation(null);
      setBtPaymentAmount('');
      setBtProcessingFee('');
    },
    onError: (error: any) => {
      Toast.show({
        type: 'error',
        text1: 'Failed to Process BT',
        text2: error.message || 'Could not process BT payment',
        position: 'bottom',
      });
    },
  });

  const handleOpenBtPayment = (allocation: LoanBtAllocation) => {
    setSelectedBtAllocation(allocation);
    setBtPaymentAmount(allocation.allocatedAmount);
    setBtPaymentDate(new Date());
    setBtProcessingFee('');
    setBtPaymentModalVisible(true);
  };

  const handleProcessBtPayment = () => {
    if (!selectedBtAllocation) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'No allocation selected',
        position: 'bottom',
      });
      return;
    }
    
    const btAmount = parseFloat(btPaymentAmount);
    
    // Validate numeric input
    if (isNaN(btAmount) || btAmount <= 0) {
      Toast.show({
        type: 'error',
        text1: 'Invalid Amount',
        text2: 'Please enter a valid positive amount',
        position: 'bottom',
      });
      return;
    }
    
    const targetLoan = allLoans.find(l => l.id === selectedBtAllocation.targetLoanId);
    const outstanding = targetLoan ? parseFloat(targetLoan.outstandingAmount) : parseFloat(selectedBtAllocation.originalOutstandingAmount);
    
    if (btAmount > outstanding) {
      Toast.show({
        type: 'error',
        text1: 'Invalid Amount',
        text2: 'BT amount cannot exceed outstanding amount',
        position: 'bottom',
      });
      return;
    }
    
    // Validate processing fee if provided
    if (btProcessingFee) {
      const fee = parseFloat(btProcessingFee);
      if (isNaN(fee) || fee < 0) {
        Toast.show({
          type: 'error',
          text1: 'Invalid Fee',
          text2: 'Please enter a valid processing fee',
          position: 'bottom',
        });
        return;
      }
    }
    
    btPaymentMutation.mutate({
      allocationId: selectedBtAllocation.id,
      actualBtAmount: btPaymentAmount,
      processedDate: btPaymentDate.toISOString(),
      processingFee: btProcessingFee || undefined,
    });
  };

  const handleEditPayment = (payment: LoanPayment) => {
    setEditingPayment(payment);
    setEditPayment({
      amount: payment.amount,
      principalPaid: payment.principalPaid || '',
      interestPaid: payment.interestPaid || '',
      paymentType: payment.paymentType as 'emi' | 'prepayment' | 'partial',
      notes: payment.notes || '',
    });
    setEditPaymentModalVisible(true);
  };

  const handleDeletePayment = (paymentId: number) => {
    Alert.alert(
      'Delete Payment',
      'Are you sure you want to delete this payment? This will restore the principal amount to the outstanding balance.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deletePaymentMutation.mutate(paymentId) },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
  };

  const calculateProgress = () => {
    if (!loan) return 0;
    const principal = parseFloat(loan.principalAmount) || 0;
    const outstanding = parseFloat(loan.outstandingAmount) || 0;
    if (principal <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round(((principal - outstanding) / principal) * 100)));
  };

  // Calculate preview of what happens after part payment
  const calculatePartPaymentPreview = () => {
    if (!loan || !partPaymentAmount) return null;
    
    const paymentAmount = parseFloat(partPaymentAmount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) return null;
    
    const outstanding = parseFloat(loan.outstandingAmount);
    if (paymentAmount > outstanding) return null;
    
    const newOutstanding = outstanding - paymentAmount;
    if (newOutstanding <= 0) {
      return { type: 'closure', newOutstanding: 0, newEmi: 0, newTenure: 0 };
    }
    
    // Get current loan values
    const currentEmi = parseFloat(loan.emiAmount || '0');
    const currentInterestRate = parseFloat(loan.interestRate || '0');
    const monthlyRate = currentInterestRate / 12 / 100;
    
    // Calculate remaining tenure
    const startDate = new Date(loan.startDate || new Date());
    const monthsElapsed = Math.floor(
      (partPaymentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
    );
    const originalTenure = loan.tenure || 12;
    const remainingMonths = Math.max(1, originalTenure - monthsElapsed);
    
    let newEmi = currentEmi;
    let newTenure = remainingMonths;
    
    if (partPaymentEffect === 'reduce_emi') {
      // Keep same tenure, calculate new EMI
      if (monthlyRate > 0) {
        const factor = Math.pow(1 + monthlyRate, remainingMonths);
        newEmi = (newOutstanding * monthlyRate * factor) / (factor - 1);
      } else {
        newEmi = newOutstanding / remainingMonths;
      }
      newTenure = remainingMonths;
    } else {
      // Keep same EMI, calculate new tenure
      if (monthlyRate > 0 && currentEmi > newOutstanding * monthlyRate) {
        newTenure = Math.ceil(
          Math.log(currentEmi / (currentEmi - newOutstanding * monthlyRate)) / 
          Math.log(1 + monthlyRate)
        );
      } else if (monthlyRate === 0) {
        newTenure = Math.ceil(newOutstanding / currentEmi);
      } else {
        newTenure = remainingMonths;
      }
      newEmi = currentEmi;
    }
    
    return {
      type: partPaymentEffect,
      newOutstanding,
      newEmi,
      newTenure,
      currentEmi,
      currentTenure: remainingMonths,
      monthsSaved: partPaymentEffect === 'reduce_tenure' ? remainingMonths - newTenure : 0,
      emiReduction: partPaymentEffect === 'reduce_emi' ? currentEmi - newEmi : 0,
    };
  };

  const partPaymentPreview = calculatePartPaymentPreview();

  const getUpcomingInstallments = () => {
    // Compare calendar dates, not exact timestamps — an installment due dates at
    // midnight today, so a plain `>= new Date()` check drops out of "upcoming" the
    // moment any time passes after midnight on its due day.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return installments
      .filter(i => i.status === 'pending' && new Date(i.dueDate) >= startOfToday)
      .slice(0, 6);
  };

  const getPaidInstallments = () => {
    return installments
      .filter(i => i.status === 'paid')
      .reverse()
      .slice(0, 12);
  };

  const handleDelete = () => {
    setDeleteModalVisible(true);
  };

  const confirmDelete = () => {
    setDeleteModalVisible(false);
    deleteMutation.mutate();
  };

  if (isLoading || !loan) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const progress = calculateProgress();
  const upcomingInstallments = getUpcomingInstallments();
  const paidInstallments = getPaidInstallments();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Outstanding Card */}
        <View style={[styles.outstandingCard, { backgroundColor: '#1e293b' }]}>
          {/* Loan Name */}
          <Text style={[styles.outstandingLoanName, { color: '#fff' }]}>{loan.name}</Text>
          
          <View style={styles.outstandingContent}>
            <View>
              <Text style={styles.outstandingLabel}>Outstanding</Text>
              <Text style={styles.outstandingAmount}>
                {formatCurrency(parseFloat(loan.outstandingAmount))}
              </Text>
            </View>
            <View style={[styles.typeBadge, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
              <Text style={styles.typeBadgeText}>
                {(loan.loanType || (loan as any).type || '').replace(/_/g, ' ').toUpperCase()}
              </Text>
            </View>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressSection}>
            <View style={[styles.progressBar, { backgroundColor: 'rgba(255,255,255,0.3)' }]}>
              <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: '#fff' }]} />
            </View>
            <View style={styles.progressLabels}>
              <Text style={styles.progressText}>{progress}% repaid</Text>
              <Text style={styles.progressText}>of {formatCurrency(parseFloat(loan.principalAmount))}</Text>
            </View>
          </View>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Monthly EMI</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {formatCurrency(parseFloat(loan.emiAmount || '0'))}
            </Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Interest Rate</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{loan.interestRate}%</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Tenure</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{loan.tenure || loan.tenureMonths} months</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>EMI Date</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{loan.emiDay || '-'}th</Text>
          </View>
        </View>

        {/* Existing Loan Banner */}
        {loan.isExistingLoan && (
          <View style={[styles.existingLoanBanner, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
            <Ionicons name="information-circle" size={20} color={colors.primary} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[styles.existingLoanBannerTitle, { color: colors.text }]}>Existing Loan Tracking</Text>
              <Text style={[styles.existingLoanBannerText, { color: colors.textMuted }]}>
                This is a simplified view for loans started before tracking. Only future EMIs are shown.
              </Text>
            </View>
          </View>
        )}

        {/* Lender Info */}
        {loan.lenderName && (
          <View style={[styles.lenderCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.lenderLabel, { color: colors.textMuted }]}>Lender</Text>
            <Text style={[styles.lenderName, { color: colors.text }]}>{loan.lenderName}</Text>
            {loan.loanAccountNumber && (
              <Text style={[styles.accountNumber, { color: colors.textMuted }]}>
                Account: ****{loan.loanAccountNumber.slice(-4)}
              </Text>
            )}
          </View>
        )}

        {/* Loan Actions */}
        {/* Debug: Show for all loan statuses temporarily */}
        {loan && (
          <View style={styles.loanActionsContainer}>
            {loan.status === 'active' && (
              <>
            {/* Top-Up Action */}
            <TouchableOpacity
              style={[styles.loanActionButton, { backgroundColor: colors.card, borderColor: colors.success }]}
              onPress={() => setTopupModalVisible(true)}
            >
              <Ionicons name="add-circle" size={20} color={colors.success} />
              <View style={styles.preclosureButtonContent}>
                <Text style={[styles.preclosureButtonTitle, { color: colors.text }]}>Top-Up Loan</Text>
                <Text style={[styles.preclosureButtonSubtitle, { color: colors.textMuted }]}>
                  Add more principal to this loan
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>

            {/* Pre-Closure Action */}
            <TouchableOpacity
              style={[styles.loanActionButton, { backgroundColor: colors.card, borderColor: colors.primary }]}
              onPress={() => {
                setPreclosureAmount(loan.outstandingAmount);
                setPreclosureModalVisible(true);
              }}
            >
              <Ionicons name="checkmark-done-circle" size={20} color={colors.primary} />
              <View style={styles.preclosureButtonContent}>
                <Text style={[styles.preclosureButtonTitle, { color: colors.text }]}>Pre-Close Loan</Text>
                <Text style={[styles.preclosureButtonSubtitle, { color: colors.textMuted }]}>
                  Close loan early with settlement amount
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>

            {/* Part Payment Button */}
            <TouchableOpacity
              style={[styles.loanActionButton, { backgroundColor: colors.card, borderColor: '#3b82f6' }]}
              onPress={() => {
                setPartPaymentAmount('');
                setPartPaymentDate(new Date());
                setPartPaymentEffect('reduce_tenure');
                setPartPaymentModalVisible(true);
              }}
            >
              <Ionicons name="cash-outline" size={20} color="#3b82f6" />
              <View style={styles.preclosureButtonContent}>
                <Text style={[styles.preclosureButtonTitle, { color: colors.text }]}>Part Payment</Text>
                <Text style={[styles.preclosureButtonSubtitle, { color: colors.textMuted }]}>
                  Pay extra to reduce outstanding faster
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>

            {/* Spending Breakdown Action */}
            <TouchableOpacity
              style={[styles.loanActionButton, { backgroundColor: colors.card, borderColor: '#8b5cf6' }]}
              onPress={() => setSpendingBreakdownVisible(true)}
            >
              <Ionicons name="pie-chart-outline" size={20} color="#8b5cf6" />
              <View style={styles.preclosureButtonContent}>
                <Text style={[styles.preclosureButtonTitle, { color: colors.text }]}>Spending Breakdown</Text>
                <Text style={[styles.preclosureButtonSubtitle, { color: colors.textMuted }]}>
                  Track how the received amount was used
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
              </>
            )}

            {/* Regenerate Installments Action */}
            <TouchableOpacity
              style={[styles.loanActionButton, { backgroundColor: colors.card, borderColor: colors.warning }]}
              onPress={() => setRegenerateModalVisible(true)}
              disabled={regenerateInstallmentsMutation.isPending}
            >
              {regenerateInstallmentsMutation.isPending ? (
                <ActivityIndicator size="small" color={colors.warning} />
              ) : (
                <Ionicons name="refresh-circle" size={20} color={colors.warning} />
              )}
              <View style={styles.preclosureButtonContent}>
                <Text style={[styles.preclosureButtonTitle, { color: colors.text }]}>Regenerate Installments</Text>
                <Text style={[styles.preclosureButtonSubtitle, { color: colors.textMuted }]}>
                  {regenerateInstallmentsMutation.isPending ? 'Regenerating...' : 'Recalculate pending EMIs from current terms'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* Pre-Closed Badge */}
        {loan.status === 'preclosed' && (
          <View style={[styles.preclosedBanner, { backgroundColor: colors.success + '20', borderColor: colors.success }]}>
            <Ionicons name="checkmark-circle" size={24} color={colors.success} />
            <View style={styles.preclosedBannerContent}>
              <Text style={[styles.preclosedBannerTitle, { color: colors.success }]}>Loan Pre-Closed</Text>
              {loan.closureDate && (
                <Text style={[styles.preclosedBannerSubtitle, { color: colors.textMuted }]}>
                  Closed on {formatDate(loan.closureDate)} with {formatCurrency(parseFloat(loan.closureAmount || '0'))}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Closed via BT Banner */}
        {loan.status === 'closed_bt' && (
          <View style={[styles.preclosedBanner, { backgroundColor: colors.primary + '20', borderColor: colors.primary }]}>
            <Ionicons name="swap-horizontal" size={24} color={colors.primary} />
            <View style={styles.preclosedBannerContent}>
              <Text style={[styles.preclosedBannerTitle, { color: colors.primary }]}>Closed via Balance Transfer</Text>
              {sourceLoan ? (
                <Text style={[styles.preclosedBannerSubtitle, { color: colors.textMuted }]}>
                  BT from: {sourceLoan.name} ({sourceLoan.lenderName || 'No lender'})
                </Text>
              ) : btAsTarget.length > 0 && btAsTarget.find(bt => bt.status === 'processed' || bt.status === 'partial') ? (
                <Text style={[styles.preclosedBannerSubtitle, { color: colors.textMuted }]}>
                  BT from: {allLoans.find(l => l.id === btAsTarget.find(bt => bt.status === 'processed' || bt.status === 'partial')?.sourceLoanId)?.name || 'Another loan'}
                </Text>
              ) : null}
              {loan.closureDate && (
                <Text style={[styles.preclosedBannerSubtitle, { color: colors.textMuted }]}>
                  Closed on {formatDate(loan.closureDate)} with {formatCurrency(parseFloat(loan.closureAmount || '0'))}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Tabs */}
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          style={styles.tabsScrollView}
          contentContainerStyle={styles.tabsContainer}
        >
          <TouchableOpacity
            style={[
              styles.tab,
              activeTab === 'upcoming' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }
            ]}
            onPress={() => setActiveTab('upcoming')}
          >
            <Text style={[styles.tabText, { color: activeTab === 'upcoming' ? colors.primary : colors.textMuted }]}>
              Upcoming
            </Text>
          </TouchableOpacity>
          {/* Show Payments tab for all loans that have paid installments or payments */}
          {(paidInstallments.length > 0 || payments.length > 0) && (
            <TouchableOpacity
              style={[
                styles.tab,
                activeTab === 'payments' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }
              ]}
              onPress={() => setActiveTab('payments')}
            >
              <Text style={[styles.tabText, { color: activeTab === 'payments' ? colors.primary : colors.textMuted }]}>
                Paid
              </Text>
            </TouchableOpacity>
          )}
          {/* Only show Terms tab for non-existing loans */}
          {!loan.isExistingLoan && (
            <TouchableOpacity
              style={[
                styles.tab,
                activeTab === 'terms' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }
              ]}
              onPress={() => setActiveTab('terms')}
            >
              <Text style={[styles.tabText, { color: activeTab === 'terms' ? colors.primary : colors.textMuted }]}>
                Terms
              </Text>
            </TouchableOpacity>
          )}
          {/* BT Tab - only show if loan includes BT closure */}
          {loan.includesBtClosure && (
            <TouchableOpacity
              style={[
                styles.tab,
                activeTab === 'bt' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }
              ]}
              onPress={() => setActiveTab('bt')}
            >
              <Text style={[styles.tabText, { color: activeTab === 'bt' ? colors.primary : colors.textMuted }]}>
                BT Closures
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* Tab Content */}
        <View style={styles.tabContent}>
          {activeTab === 'upcoming' && (
            <>
              {upcomingInstallments.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
                  <Text style={[styles.emptyText, { color: colors.textMuted }]}>No upcoming installments</Text>
                </View>
              ) : (
                upcomingInstallments.map((installment, index) => {
                  const dueDate = new Date(installment.dueDate);
                  const now = new Date();
                  const startOfToday = new Date();
                  startOfToday.setHours(0, 0, 0, 0);
                  // Same calendar-date comparison as getUpcomingInstallments — an
                  // installment due today shouldn't flip to "past due" styling just
                  // because the clock has ticked past midnight.
                  const isPastDue = dueDate < startOfToday;
                  // Check if this is the current month's EMI (due in current or past month)
                  const isCurrentOrPastMonth = dueDate.getFullYear() < now.getFullYear() ||
                    (dueDate.getFullYear() === now.getFullYear() && dueDate.getMonth() <= now.getMonth());
                  // For existing loans: only allow paying the first upcoming EMI or past-due EMIs
                  // For new loans: allow paying any EMI
                  const canPay = loan.isExistingLoan 
                    ? (isCurrentOrPastMonth || index === 0) // First upcoming or past due
                    : true;
                  return (
                    <View
                      key={installment.id}
                      style={[
                        styles.installmentCard,
                        { backgroundColor: isPastDue ? colors.danger + '20' : colors.card }
                      ]}
                    >
                      <View style={styles.installmentLeft}>
                        <Ionicons
                          name={isPastDue ? 'alert-circle' : 'time'}
                          size={20}
                          color={isPastDue ? colors.danger : colors.primary}
                        />
                        <View style={styles.installmentInfo}>
                          <Text style={[styles.installmentNumber, { color: colors.text }]}>
                            EMI #{installment.installmentNumber}
                          </Text>
                          <Text style={[styles.installmentDate, { color: colors.textMuted }]}>
                            {formatDate(installment.dueDate)}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.installmentRight}>
                        <View style={styles.installmentAmounts}>
                          <Text style={[styles.installmentAmount, { color: colors.text }]}>
                            {formatCurrency(parseFloat(installment.emiAmount))}
                          </Text>
                          <Text style={[styles.installmentBreakdown, { color: colors.textMuted }]}>
                            P: {formatCurrency(parseFloat((installment as any).principalAmount || '0'))} | 
                            I: {formatCurrency(parseFloat((installment as any).interestAmount || '0'))}
                          </Text>
                        </View>
                        {canPay ? (
                          <TouchableOpacity
                            style={[
                              styles.payButton, 
                              { backgroundColor: colors.primary },
                              processingInstallmentId !== null && { opacity: 0.5 }
                            ]}
                            onPress={() => {
                              setSelectedInstallment(installment);
                              setPayEmiCreateTransaction(false);
                              setPayEmiAffectBalance(false);
                              setPayEmiModalVisible(true);
                            }}
                            disabled={processingInstallmentId !== null}
                          >
                            {processingInstallmentId === installment.id ? (
                              <ActivityIndicator color="#fff" size="small" />
                            ) : (
                              <Text style={styles.payButtonText}>Pay</Text>
                            )}
                          </TouchableOpacity>
                        ) : (
                          <View style={[styles.payButton, { backgroundColor: colors.border, opacity: 0.5 }]}>
                            <Text style={[styles.payButtonText, { color: colors.textMuted }]}>Future</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </>
          )}

          {activeTab === 'terms' && !loan.isExistingLoan && (
            <>
              <TouchableOpacity
                style={[styles.addRowButton, { backgroundColor: colors.primary }]}
                onPress={() => setAddTermModalVisible(true)}
              >
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.addRowButtonText}>Record Term Change</Text>
              </TouchableOpacity>
              {terms.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
                  <Text style={[styles.emptyText, { color: colors.textMuted }]}>No term changes recorded</Text>
                </View>
              ) : (
                terms.slice().reverse().map((term, index) => (
                  <View
                    key={term.id}
                    style={[styles.termCard, { backgroundColor: index === 0 ? colors.primary + '20' : colors.card }]}
                  >
                    <View style={styles.termHeader}>
                      <View style={[styles.termIcon, { backgroundColor: index === 0 ? colors.primary : colors.textMuted }]}>
                        <Ionicons name="document-text" size={16} color="#fff" />
                      </View>
                      <View style={styles.termInfo}>
                        <Text style={[styles.termLabel, { color: colors.text }]}>
                          {index === 0 ? 'Current Term' : `Term ${terms.length - index}`}
                        </Text>
                        <Text style={[styles.termDate, { color: colors.textMuted }]}>
                          From {formatDate(term.effectiveFrom)}
                          {term.effectiveTo && ` to ${formatDate(term.effectiveTo)}`}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.termDetails}>
                      <View style={styles.termStat}>
                        <Text style={[styles.termStatLabel, { color: colors.textMuted }]}>Rate</Text>
                        <Text style={[styles.termStatValue, { color: colors.text }]}>{term.interestRate}%</Text>
                      </View>
                      <View style={styles.termStat}>
                        <Text style={[styles.termStatLabel, { color: colors.textMuted }]}>Tenure</Text>
                        <Text style={[styles.termStatValue, { color: colors.text }]}>{term.tenureMonths} mo</Text>
                      </View>
                      <View style={styles.termStat}>
                        <Text style={[styles.termStatLabel, { color: colors.textMuted }]}>EMI</Text>
                        <Text style={[styles.termStatValue, { color: colors.text }]}>{formatCurrency(parseFloat(term.emiAmount))}</Text>
                      </View>
                    </View>
                    {term.reason && (
                      <Text style={[styles.termReason, { color: colors.textMuted }]}>
                        Reason: {term.reason}
                      </Text>
                    )}
                  </View>
                ))
              )}
            </>
          )}

          {activeTab === 'payments' && (
            <>
              <TouchableOpacity
                style={[styles.addRowButton, { backgroundColor: colors.primary }]}
                onPress={() => setAddPaymentModalVisible(true)}
              >
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.addRowButtonText}>Record Payment</Text>
              </TouchableOpacity>
              
              {/* Paid Installments Section */}
              {paidInstallments.length > 0 && (
                <>
                  <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>Paid EMIs</Text>
                  {paidInstallments.map((installment) => (
                    <View
                      key={`inst-${installment.id}`}
                      style={[styles.installmentCard, { backgroundColor: colors.primary + '20' }]}
                    >
                      <View style={styles.installmentLeft}>
                        <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                        <View style={styles.installmentInfo}>
                          <Text style={[styles.installmentNumber, { color: colors.text }]}>
                            EMI #{installment.installmentNumber}
                          </Text>
                          <Text style={[styles.installmentDate, { color: colors.textMuted }]}>
                            Paid on {formatDate(installment.paidDate || installment.dueDate)}
                          </Text>
                          <Text style={[styles.installmentBreakdown, { color: colors.textMuted }]}>
                            P: {formatCurrency(parseFloat((installment as any).principalAmount || '0'))} | 
                            I: {formatCurrency(parseFloat((installment as any).interestAmount || '0'))}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.installmentAmount, { color: colors.text }]}>
                        {formatCurrency(parseFloat(installment.paidAmount || installment.emiAmount))}
                      </Text>
                    </View>
                  ))}
                </>
              )}
              
              {/* Manual Payments Section with swipe actions */}
              {payments.length > 0 && (
                <>
                  <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>Manual Payments</Text>
                  {payments.map((payment) => (
                    <Swipeable
                      key={payment.id}
                      renderRightActions={() => (
                        <View style={styles.swipeActionsContainer}>
                          <TouchableOpacity
                            style={[styles.swipeActionButton, { backgroundColor: colors.primary }]}
                            onPress={() => handleEditPayment(payment)}
                          >
                            <Ionicons name="pencil" size={20} color="#fff" />
                            <Text style={styles.swipeActionText}>Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.swipeActionButton, { backgroundColor: colors.danger }]}
                            onPress={() => handleDeletePayment(payment.id)}
                          >
                            <Ionicons name="trash" size={20} color="#fff" />
                            <Text style={styles.swipeActionText}>Delete</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      overshootRight={false}
                    >
                      <View style={[styles.paymentCard, { backgroundColor: colors.card }]}>
                        <View style={styles.paymentHeader}>
                          <View style={[styles.paymentIcon, { backgroundColor: payment.paymentType === 'prepayment' ? colors.warning : payment.paymentType === 'partial' ? colors.warning : colors.primary }]}>
                            <Ionicons 
                              name={payment.paymentType === 'prepayment' ? 'flash' : payment.paymentType === 'partial' ? 'pie-chart' : 'wallet'} 
                              size={16} 
                              color="#fff" 
                            />
                          </View>
                          <View style={styles.paymentInfo}>
                            <Text style={[styles.paymentType, { color: colors.text }]}>
                              {payment.paymentType === 'emi' ? 'EMI Payment' : payment.paymentType === 'prepayment' ? 'Prepayment' : 'Partial Payment'}
                            </Text>
                            <Text style={[styles.paymentDate, { color: colors.textMuted }]}>
                              {formatDate(payment.paymentDate)}
                            </Text>
                          </View>
                          <Text style={[styles.paymentAmount, { color: colors.text }]}>
                            {formatCurrency(parseFloat(payment.amount))}
                          </Text>
                        </View>
                        <View style={styles.paymentBreakdown}>
                          <Text style={[styles.paymentBreakdownText, { color: colors.textMuted }]}>
                            Principal: {formatCurrency(parseFloat(payment.principalPaid || '0'))} | Interest: {formatCurrency(parseFloat(payment.interestPaid || '0'))}
                          </Text>
                        </View>
                        {payment.notes && (
                          <Text style={[styles.paymentNotes, { color: colors.textMuted }]}>
                            {payment.notes}
                          </Text>
                        )}
                      </View>
                    </Swipeable>
                  ))}
                </>
              )}
              
              {paidInstallments.length === 0 && payments.length === 0 && (
                <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
                  <Text style={[styles.emptyText, { color: colors.textMuted }]}>No payments recorded yet</Text>
                </View>
              )}
            </>
          )}

          {/* BT Tab Content */}
          {activeTab === 'bt' && loan.includesBtClosure && (
            <>
              {btAllocations.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
                  <Text style={[styles.emptyText, { color: colors.textMuted }]}>No BT allocations found</Text>
                </View>
              ) : (
                <>
                  {/* Pending BT Allocations */}
                  {btAllocations.filter(bt => bt.status === 'pending').length > 0 && (
                    <>
                      <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>Pending BT Closures</Text>
                      {btAllocations.filter(bt => bt.status === 'pending').map((bt) => {
                        const targetLoan = allLoans.find(l => l.id === bt.targetLoanId);
                        return (
                          <View key={bt.id} style={[styles.btCard, { backgroundColor: colors.card }]}>
                            <View style={styles.btCardHeader}>
                              <View style={[styles.btIcon, { backgroundColor: colors.warning + '20' }]}>
                                <Ionicons name="time" size={20} color={colors.warning} />
                              </View>
                              <View style={styles.btInfo}>
                                <Text style={[styles.btTargetName, { color: colors.text }]}>
                                  {targetLoan?.name || 'Unknown Loan'}
                                </Text>
                                <Text style={[styles.btLenderName, { color: colors.textMuted }]}>
                                  {targetLoan?.lenderName || 'No lender'}
                                </Text>
                              </View>
                              <TouchableOpacity
                                style={[styles.btPayButton, { backgroundColor: colors.primary }]}
                                onPress={() => handleOpenBtPayment(bt)}
                              >
                                <Text style={styles.btPayButtonText}>Pay</Text>
                              </TouchableOpacity>
                            </View>
                            <View style={styles.btDetails}>
                              <View style={styles.btDetailRow}>
                                <Text style={[styles.btDetailLabel, { color: colors.textMuted }]}>Original Outstanding</Text>
                                <Text style={[styles.btDetailValue, { color: colors.text }]}>
                                  {formatCurrency(parseFloat(bt.originalOutstandingAmount))}
                                </Text>
                              </View>
                              <View style={styles.btDetailRow}>
                                <Text style={[styles.btDetailLabel, { color: colors.textMuted }]}>Allocated BT Amount</Text>
                                <Text style={[styles.btDetailValue, { color: colors.primary }]}>
                                  {formatCurrency(parseFloat(bt.allocatedAmount))}
                                </Text>
                              </View>
                            </View>
                          </View>
                        );
                      })}
                    </>
                  )}
                  
                  {/* Processed BT Allocations */}
                  {btAllocations.filter(bt => bt.status === 'processed').length > 0 && (
                    <>
                      <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>Processed BT Closures</Text>
                      {btAllocations.filter(bt => bt.status === 'processed').map((bt) => {
                        const targetLoan = allLoans.find(l => l.id === bt.targetLoanId);
                        const isFullClosure = parseFloat(bt.actualBtAmount || bt.allocatedAmount) >= parseFloat(bt.originalOutstandingAmount);
                        return (
                          <View key={bt.id} style={[styles.btCard, { backgroundColor: colors.card }]}>
                            <View style={styles.btCardHeader}>
                              <View style={[styles.btIcon, { backgroundColor: colors.success + '20' }]}>
                                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                              </View>
                              <View style={styles.btInfo}>
                                <Text style={[styles.btTargetName, { color: colors.text }]}>
                                  {targetLoan?.name || 'Unknown Loan'}
                                </Text>
                                <Text style={[styles.btLenderName, { color: colors.textMuted }]}>
                                  {targetLoan?.lenderName || 'No lender'}
                                </Text>
                              </View>
                              <View style={[styles.btStatusBadge, { backgroundColor: isFullClosure ? colors.success + '20' : colors.primary + '20' }]}>
                                <Text style={[styles.btStatusText, { color: isFullClosure ? colors.success : colors.primary }]}>
                                  {isFullClosure ? 'Closed' : 'Partial'}
                                </Text>
                              </View>
                            </View>
                            <View style={styles.btDetails}>
                              <View style={styles.btDetailRow}>
                                <Text style={[styles.btDetailLabel, { color: colors.textMuted }]}>Original Outstanding</Text>
                                <Text style={[styles.btDetailValue, { color: colors.text }]}>
                                  {formatCurrency(parseFloat(bt.originalOutstandingAmount))}
                                </Text>
                              </View>
                              <View style={styles.btDetailRow}>
                                <Text style={[styles.btDetailLabel, { color: colors.textMuted }]}>BT Amount Paid</Text>
                                <Text style={[styles.btDetailValue, { color: colors.success }]}>
                                  {formatCurrency(parseFloat(bt.actualBtAmount || bt.allocatedAmount))}
                                </Text>
                              </View>
                              {bt.processingFee && parseFloat(bt.processingFee) > 0 && (
                                <View style={styles.btDetailRow}>
                                  <Text style={[styles.btDetailLabel, { color: colors.textMuted }]}>Processing Fee</Text>
                                  <Text style={[styles.btDetailValue, { color: colors.danger }]}>
                                    {formatCurrency(parseFloat(bt.processingFee))}
                                  </Text>
                                </View>
                              )}
                              {bt.processedDate && (
                                <View style={styles.btDetailRow}>
                                  <Text style={[styles.btDetailLabel, { color: colors.textMuted }]}>Processed On</Text>
                                  <Text style={[styles.btDetailValue, { color: colors.textMuted }]}>
                                    {formatDate(bt.processedDate)}
                                  </Text>
                                </View>
                              )}
                            </View>
                          </View>
                        );
                      })}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Ionicons name="warning" size={48} color={colors.danger} />
            <Text style={[styles.modalTitle, { color: colors.text }]}>Delete Loan?</Text>
            <Text style={[styles.modalMessage, { color: colors.textMuted }]}>
              This will permanently delete this loan and all its installments. This action cannot be undone.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton, { backgroundColor: colors.background }]}
                onPress={() => setDeleteModalVisible(false)}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton, { backgroundColor: colors.danger }]}
                onPress={confirmDelete}
              >
                <Text style={styles.confirmButtonText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Pay EMI Modal */}
      <Modal
        visible={payEmiModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPayEmiModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.formModalContent, { backgroundColor: colors.card }]}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
              <Ionicons name="cash" size={48} color={colors.primary} style={{ alignSelf: 'center' }} />
              <Text style={[styles.formModalTitle, { color: colors.text, textAlign: 'center' }]}>Pay EMI</Text>
              <Text style={[styles.formModalSubtitle, { color: colors.textMuted, textAlign: 'center' }]}>
                Confirm payment for {selectedInstallment?.dueDate ? new Date(selectedInstallment.dueDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'this installment'}
              </Text>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Amount</Text>
              <View style={[styles.formInput, { backgroundColor: colors.background, borderColor: colors.border, justifyContent: 'center' }]}>
                <Text style={{ color: colors.text, fontSize: 16 }}>
                  {formatCurrency(parseFloat(selectedInstallment?.emiAmount || '0'))}
                </Text>
              </View>
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Text style={[styles.toggleLabel, { color: colors.text }]}>Create Transaction</Text>
                <Text style={[styles.toggleHint, { color: colors.textMuted }]}>
                  Record this payment as a transaction
                </Text>
              </View>
              <Switch
                value={payEmiCreateTransaction}
                onValueChange={setPayEmiCreateTransaction}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Text style={[styles.toggleLabel, { color: colors.text }]}>Affect Account Balance</Text>
                <Text style={[styles.toggleHint, { color: colors.textMuted }]}>
                  Deduct from linked account balance
                </Text>
              </View>
              <Switch
                value={payEmiAffectBalance}
                onValueChange={setPayEmiAffectBalance}
                trackColor={{ false: colors.border, true: colors.primary }}
                disabled={!loan?.accountId}
              />
            </View>

            <Text style={[styles.toggleNote, { color: colors.textMuted }]}>
              These settings apply to this payment only
            </Text>
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton, { backgroundColor: colors.background }]}
                onPress={() => {
                  setPayEmiModalVisible(false);
                  setSelectedInstallment(null);
                }}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton, { backgroundColor: colors.primary }]}
                onPress={() => {
                  if (selectedInstallment) {
                    markPaidMutation.mutate({
                      installmentId: selectedInstallment.id,
                      amount: selectedInstallment.emiAmount,
                      createTransaction: payEmiCreateTransaction,
                      affectBalance: payEmiAffectBalance,
                    });
                  }
                }}
                disabled={markPaidMutation.isPending}
              >
                {markPaidMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmButtonText}>Confirm</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Pre-Closure Modal */}
      <Modal
        visible={preclosureModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPreclosureModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.formModalContent, { backgroundColor: colors.card }]}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
              <Ionicons name="checkmark-done-circle" size={48} color={colors.primary} style={{ alignSelf: 'center' }} />
              <Text style={[styles.formModalTitle, { color: colors.text, textAlign: 'center' }]}>Pre-Close Loan</Text>
              <Text style={[styles.formModalSubtitle, { color: colors.textMuted, textAlign: 'center' }]}>
                Enter the settlement amount and date to close this loan early
              </Text>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Settlement Amount</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="Enter settlement amount"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                value={preclosureAmount}
                onChangeText={setPreclosureAmount}
              />
              <Text style={[styles.formHint, { color: colors.textMuted }]}>
                Outstanding: {formatCurrency(parseFloat(loan?.outstandingAmount || '0'))}
              </Text>
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Closure Date</Text>
              <TouchableOpacity
                style={[styles.formInput, { backgroundColor: colors.background, borderColor: colors.border, justifyContent: 'center' }]}
                onPress={() => setShowPreclosureDatePicker(true)}
              >
                <Text style={{ color: colors.text }}>
                  {preclosureDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
              </TouchableOpacity>
              {showPreclosureDatePicker && (
                <DateTimePicker
                  value={preclosureDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, date) => {
                    setShowPreclosureDatePicker(Platform.OS === 'ios');
                    if (date) setPreclosureDate(date);
                  }}
                />
              )}
            </View>
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton, { backgroundColor: colors.background }]}
                onPress={() => {
                  setPreclosureModalVisible(false);
                  setPreclosureAmount('');
                  setPreclosureDate(new Date());
                }}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton, { backgroundColor: colors.primary }]}
                onPress={() => {
                  const amount = parseFloat(preclosureAmount);
                  if (!preclosureAmount || isNaN(amount) || amount <= 0) {
                    Toast.show({
                      type: 'error',
                      text1: 'Invalid Amount',
                      text2: 'Please enter a valid settlement amount',
                      position: 'bottom',
                    });
                    return;
                  }
                  precloseMutation.mutate({
                    closureAmount: preclosureAmount,
                    closureDate: preclosureDate.toISOString().split('T')[0],
                    accountId: loan?.accountId || undefined,
                    createTransaction: !!loan?.accountId,
                  });
                }}
                disabled={precloseMutation.isPending || !preclosureAmount || parseFloat(preclosureAmount) <= 0}
              >
                {precloseMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmButtonText}>Confirm Pre-Closure</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Part Payment Modal */}
      <Modal
        visible={partPaymentModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPartPaymentModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.formModalContent, { backgroundColor: colors.card }]}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
              <Ionicons name="cash-outline" size={48} color="#3b82f6" style={{ alignSelf: 'center' }} />
              <Text style={[styles.formModalTitle, { color: colors.text, textAlign: 'center' }]}>Part Payment</Text>
              <Text style={[styles.formModalSubtitle, { color: colors.textMuted, textAlign: 'center' }]}>
                Pay extra to reduce your outstanding balance faster
              </Text>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Payment Amount</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="Enter amount"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                value={partPaymentAmount}
                onChangeText={setPartPaymentAmount}
              />
              <Text style={[styles.formHint, { color: colors.textMuted }]}>
                Outstanding: {formatCurrency(parseFloat(loan?.outstandingAmount || '0'))}
              </Text>
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Payment Date</Text>
              <TouchableOpacity
                style={[styles.formInput, { backgroundColor: colors.background, borderColor: colors.border, justifyContent: 'center' }]}
                onPress={() => setShowPartPaymentDatePicker(true)}
              >
                <Text style={{ color: colors.text }}>
                  {partPaymentDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
              </TouchableOpacity>
              {showPartPaymentDatePicker && (
                <DateTimePicker
                  value={partPaymentDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, date) => {
                    setShowPartPaymentDatePicker(Platform.OS === 'ios');
                    if (date) setPartPaymentDate(date);
                  }}
                />
              )}
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Effect of Payment</Text>
              <View style={styles.effectOptions}>
                <TouchableOpacity
                  style={[
                    styles.effectOption,
                    { 
                      backgroundColor: partPaymentEffect === 'reduce_tenure' ? colors.primary + '20' : colors.background,
                      borderColor: partPaymentEffect === 'reduce_tenure' ? colors.primary : colors.border
                    }
                  ]}
                  onPress={() => setPartPaymentEffect('reduce_tenure')}
                >
                  <Ionicons 
                    name={partPaymentEffect === 'reduce_tenure' ? 'radio-button-on' : 'radio-button-off'} 
                    size={20} 
                    color={partPaymentEffect === 'reduce_tenure' ? colors.primary : colors.textMuted} 
                  />
                  <View style={styles.effectOptionText}>
                    <Text style={[styles.effectOptionTitle, { color: colors.text }]}>Reduce Tenure</Text>
                    <Text style={[styles.effectOptionSubtitle, { color: colors.textMuted }]}>Same EMI, finish earlier</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.effectOption,
                    { 
                      backgroundColor: partPaymentEffect === 'reduce_emi' ? colors.primary + '20' : colors.background,
                      borderColor: partPaymentEffect === 'reduce_emi' ? colors.primary : colors.border
                    }
                  ]}
                  onPress={() => setPartPaymentEffect('reduce_emi')}
                >
                  <Ionicons 
                    name={partPaymentEffect === 'reduce_emi' ? 'radio-button-on' : 'radio-button-off'} 
                    size={20} 
                    color={partPaymentEffect === 'reduce_emi' ? colors.primary : colors.textMuted} 
                  />
                  <View style={styles.effectOptionText}>
                    <Text style={[styles.effectOptionTitle, { color: colors.text }]}>Reduce EMI</Text>
                    <Text style={[styles.effectOptionSubtitle, { color: colors.textMuted }]}>Lower EMI, same tenure</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            {/* Preview Section */}
            {partPaymentPreview && (
              <View style={[styles.previewSection, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[styles.previewTitle, { color: colors.text }]}>
                  {partPaymentPreview.type === 'closure' ? 'Loan will be closed!' : 'After this payment:'}
                </Text>
                {partPaymentPreview.type === 'closure' ? (
                  <View style={styles.previewRow}>
                    <Ionicons name="checkmark-circle" size={24} color={colors.success} />
                    <Text style={[styles.previewText, { color: colors.success }]}>
                      Payment of {formatCurrency(parseFloat(partPaymentAmount))} will close this loan
                    </Text>
                  </View>
                ) : partPaymentPreview.type === 'reduce_tenure' ? (
                  <>
                    <View style={styles.previewRow}>
                      <Text style={[styles.previewLabel, { color: colors.textMuted }]}>New Outstanding:</Text>
                      <Text style={[styles.previewValue, { color: colors.text }]}>
                        {formatCurrency(partPaymentPreview.newOutstanding)}
                      </Text>
                    </View>
                    <View style={styles.previewRow}>
                      <Text style={[styles.previewLabel, { color: colors.textMuted }]}>New Tenure:</Text>
                      <Text style={[styles.previewValue, { color: colors.primary }]}>
                        {partPaymentPreview.newTenure} months
                        <Text style={{ color: colors.success }}> (save {partPaymentPreview.monthsSaved} months)</Text>
                      </Text>
                    </View>
                    <View style={styles.previewRow}>
                      <Text style={[styles.previewLabel, { color: colors.textMuted }]}>EMI remains:</Text>
                      <Text style={[styles.previewValue, { color: colors.text }]}>
                        {formatCurrency(partPaymentPreview.currentEmi || 0)}
                      </Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.previewRow}>
                      <Text style={[styles.previewLabel, { color: colors.textMuted }]}>New Outstanding:</Text>
                      <Text style={[styles.previewValue, { color: colors.text }]}>
                        {formatCurrency(partPaymentPreview.newOutstanding)}
                      </Text>
                    </View>
                    <View style={styles.previewRow}>
                      <Text style={[styles.previewLabel, { color: colors.textMuted }]}>New EMI:</Text>
                      <Text style={[styles.previewValue, { color: colors.primary }]}>
                        {formatCurrency(partPaymentPreview.newEmi)}
                        <Text style={{ color: colors.success }}> (save {formatCurrency(partPaymentPreview.emiReduction || 0)}/month)</Text>
                      </Text>
                    </View>
                    <View style={styles.previewRow}>
                      <Text style={[styles.previewLabel, { color: colors.textMuted }]}>Tenure remains:</Text>
                      <Text style={[styles.previewValue, { color: colors.text }]}>
                        {partPaymentPreview.currentTenure} months
                      </Text>
                    </View>
                  </>
                )}
              </View>
            )}
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton, { backgroundColor: colors.background }]}
                onPress={() => {
                  setPartPaymentModalVisible(false);
                  setPartPaymentAmount('');
                  setPartPaymentDate(new Date());
                }}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton, { backgroundColor: colors.primary }]}
                onPress={() => {
                  const amount = parseFloat(partPaymentAmount);
                  const outstanding = parseFloat(loan?.outstandingAmount || '0');
                  if (!partPaymentAmount || isNaN(amount) || amount <= 0) {
                    Toast.show({
                      type: 'error',
                      text1: 'Invalid Amount',
                      text2: 'Please enter a valid payment amount',
                      position: 'bottom',
                    });
                    return;
                  }
                  if (amount > outstanding) {
                    Toast.show({
                      type: 'error',
                      text1: 'Amount Too High',
                      text2: 'Payment cannot exceed outstanding balance',
                      position: 'bottom',
                    });
                    return;
                  }
                  partPaymentMutation.mutate({
                    amount: partPaymentAmount,
                    paymentDate: partPaymentDate.toISOString().split('T')[0],
                    effect: partPaymentEffect,
                    accountId: loan?.accountId || undefined,
                    createTransaction: !!loan?.accountId,
                  });
                }}
                disabled={partPaymentMutation.isPending || !partPaymentAmount || parseFloat(partPaymentAmount) <= 0}
              >
                {partPaymentMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmButtonText}>Make Payment</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Top-Up Modal */}
      <Modal
        visible={topupModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTopupModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.formModalContent, { backgroundColor: colors.card }]}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
              <Ionicons name="add-circle" size={48} color={colors.success} style={{ alignSelf: 'center' }} />
              <Text style={[styles.formModalTitle, { color: colors.text, textAlign: 'center' }]}>Top-Up Loan</Text>
              <Text style={[styles.formModalSubtitle, { color: colors.textMuted, textAlign: 'center' }]}>
                Add additional principal to your loan
              </Text>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Top-Up Amount</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="Enter top-up amount"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                value={topupData.topupAmount}
                onChangeText={(text) => setTopupData({ ...topupData, topupAmount: text })}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>New EMI Amount (optional)</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="Leave blank to keep current EMI"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                value={topupData.newEmiAmount}
                onChangeText={(text) => setTopupData({ ...topupData, newEmiAmount: text })}
              />
              <Text style={[styles.formHint, { color: colors.textMuted }]}>
                Current EMI: {formatCurrency(parseFloat(loan?.emiAmount || '0'))}
              </Text>
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Additional Tenure (months, optional)</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="Leave blank to keep current tenure"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                value={topupData.additionalTenure}
                onChangeText={(text) => setTopupData({ ...topupData, additionalTenure: text })}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Notes (optional)</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="Reason for top-up"
                placeholderTextColor={colors.textMuted}
                value={topupData.notes}
                onChangeText={(text) => setTopupData({ ...topupData, notes: text })}
              />
            </View>
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton, { backgroundColor: colors.background }]}
                onPress={() => {
                  setTopupModalVisible(false);
                  setTopupData({ topupAmount: '', newEmiAmount: '', additionalTenure: '', notes: '' });
                }}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton, { backgroundColor: colors.success }]}
                onPress={() => {
                  const amount = parseFloat(topupData.topupAmount);
                  if (!topupData.topupAmount || isNaN(amount) || amount <= 0) {
                    Toast.show({
                      type: 'error',
                      text1: 'Invalid Amount',
                      text2: 'Please enter a valid top-up amount',
                      position: 'bottom',
                    });
                    return;
                  }
                  topupMutation.mutate({
                    topupAmount: topupData.topupAmount,
                    newEmiAmount: topupData.newEmiAmount || undefined,
                    additionalTenure: topupData.additionalTenure ? parseInt(topupData.additionalTenure) : undefined,
                    accountId: loan?.accountId || undefined,
                    createTransaction: !!loan?.accountId,
                    notes: topupData.notes || undefined,
                  });
                }}
                disabled={topupMutation.isPending || !topupData.topupAmount || parseFloat(topupData.topupAmount) <= 0}
                accessibilityLabel="Confirm loan top-up"
                accessibilityRole="button"
              >
                {topupMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmButtonText}>Confirm Top-Up</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Term Modal */}
      <Modal
        visible={addTermModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddTermModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.formModalContent, { backgroundColor: colors.card }]}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
              <Text style={[styles.formModalTitle, { color: colors.text, textAlign: 'center' }]}>Record Term Change</Text>
              <Text style={[styles.formModalSubtitle, { color: colors.textMuted, textAlign: 'center' }]}>
                Record a change in interest rate, tenure, or EMI
              </Text>
            
            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Interest Rate (%)</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="e.g., 8.5"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                value={newTerm.interestRate}
                onChangeText={(text) => setNewTerm({ ...newTerm, interestRate: text })}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Tenure (months)</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="e.g., 240"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                value={newTerm.tenureMonths}
                onChangeText={(text) => setNewTerm({ ...newTerm, tenureMonths: text })}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>New EMI Amount</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="e.g., 25000"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                value={newTerm.emiAmount}
                onChangeText={(text) => setNewTerm({ ...newTerm, emiAmount: text })}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Reason (optional)</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="e.g., Rate revision by bank"
                placeholderTextColor={colors.textMuted}
                value={newTerm.reason}
                onChangeText={(text) => setNewTerm({ ...newTerm, reason: text })}
              />
            </View>
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton, { backgroundColor: colors.background }]}
                onPress={() => setAddTermModalVisible(false)}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton, { backgroundColor: colors.primary }]}
                onPress={() => addTermMutation.mutate(newTerm)}
                disabled={addTermMutation.isPending || !newTerm.interestRate || !newTerm.tenureMonths || !newTerm.emiAmount}
              >
                {addTermMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmButtonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Payment Modal */}
      <Modal
        visible={addPaymentModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddPaymentModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.formModalContent, { backgroundColor: colors.card }]}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
              <Text style={[styles.formModalTitle, { color: colors.text, textAlign: 'center' }]}>Record Payment</Text>
              <Text style={[styles.formModalSubtitle, { color: colors.textMuted, textAlign: 'center' }]}>
                Record a payment outside of the regular EMI schedule
              </Text>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Payment Type</Text>
              <View style={styles.paymentTypeRow}>
                {(['emi', 'prepayment', 'partial'] as const).map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.paymentTypeButton,
                      { backgroundColor: newPayment.paymentType === type ? colors.primary : colors.background, borderColor: colors.border }
                    ]}
                    onPress={() => setNewPayment({ ...newPayment, paymentType: type })}
                  >
                    <Text style={{ color: newPayment.paymentType === type ? '#fff' : colors.text, fontSize: 12 }}>
                      {type === 'emi' ? 'EMI' : type === 'prepayment' ? 'Prepayment' : 'Partial'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Total Amount</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="e.g., 25000"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                value={newPayment.amount}
                onChangeText={(text) => setNewPayment({ ...newPayment, amount: text })}
              />
            </View>

            <View style={styles.formRow}>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={[styles.formLabel, { color: colors.text }]}>Principal</Text>
                <TextInput
                  style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  value={newPayment.principalPaid}
                  onChangeText={(text) => setNewPayment({ ...newPayment, principalPaid: text })}
                />
              </View>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={[styles.formLabel, { color: colors.text }]}>Interest</Text>
                <TextInput
                  style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  value={newPayment.interestPaid}
                  onChangeText={(text) => setNewPayment({ ...newPayment, interestPaid: text })}
                />
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Notes (optional)</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="e.g., Extra payment to reduce tenure"
                placeholderTextColor={colors.textMuted}
                value={newPayment.notes}
                onChangeText={(text) => setNewPayment({ ...newPayment, notes: text })}
              />
            </View>
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton, { backgroundColor: colors.background }]}
                onPress={() => setAddPaymentModalVisible(false)}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton, { backgroundColor: colors.primary }]}
                onPress={() => addPaymentMutation.mutate(newPayment)}
                disabled={addPaymentMutation.isPending || !newPayment.amount}
              >
                {addPaymentMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmButtonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Payment Modal */}
      <Modal
        visible={editPaymentModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setEditPaymentModalVisible(false);
          setEditingPayment(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.formModalContent, { backgroundColor: colors.card }]}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
              <Text style={[styles.formModalTitle, { color: colors.text, textAlign: 'center' }]}>Edit Payment</Text>
              <Text style={[styles.formModalSubtitle, { color: colors.textMuted, textAlign: 'center' }]}>
                Update payment details
              </Text>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Payment Type</Text>
              <View style={styles.paymentTypeRow}>
                {(['emi', 'prepayment', 'partial'] as const).map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.paymentTypeButton,
                      { backgroundColor: editPayment.paymentType === type ? colors.primary : colors.background, borderColor: colors.border }
                    ]}
                    onPress={() => setEditPayment({ ...editPayment, paymentType: type })}
                  >
                    <Text style={{ color: editPayment.paymentType === type ? '#fff' : colors.text, fontSize: 12 }}>
                      {type === 'emi' ? 'EMI' : type === 'prepayment' ? 'Prepayment' : 'Partial'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Total Amount</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="e.g., 25000"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                value={editPayment.amount}
                onChangeText={(text: string) => setEditPayment({ ...editPayment, amount: text })}
              />
            </View>

            <View style={styles.formRow}>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={[styles.formLabel, { color: colors.text }]}>Principal</Text>
                <TextInput
                  style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  value={editPayment.principalPaid}
                  onChangeText={(text: string) => setEditPayment({ ...editPayment, principalPaid: text })}
                />
              </View>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={[styles.formLabel, { color: colors.text }]}>Interest</Text>
                <TextInput
                  style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  value={editPayment.interestPaid}
                  onChangeText={(text: string) => setEditPayment({ ...editPayment, interestPaid: text })}
                />
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Notes (optional)</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="e.g., Extra payment to reduce tenure"
                placeholderTextColor={colors.textMuted}
                value={editPayment.notes}
                onChangeText={(text: string) => setEditPayment({ ...editPayment, notes: text })}
              />
            </View>
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton, { backgroundColor: colors.background }]}
                onPress={() => {
                  setEditPaymentModalVisible(false);
                  setEditingPayment(null);
                }}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton, { backgroundColor: colors.primary }]}
                onPress={() => editingPayment && updatePaymentMutation.mutate({ id: editingPayment.id, ...editPayment })}
                disabled={updatePaymentMutation.isPending || !editPayment.amount}
              >
                {updatePaymentMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmButtonText}>Update</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Regenerate Confirmation Modal */}
      <Modal
        visible={regenerateModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRegenerateModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Ionicons name="refresh-circle" size={48} color={colors.warning} />
            <Text style={[styles.modalTitle, { color: colors.text }]}>Regenerate Installments?</Text>
            <Text style={[styles.modalMessage, { color: colors.textMuted }]}>
              This will delete all pending installments and recreate them starting from current month based on loan terms. Paid installments will not be affected.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton, { backgroundColor: colors.background }]}
                onPress={() => setRegenerateModalVisible(false)}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton, { backgroundColor: colors.warning }]}
                onPress={() => {
                  setRegenerateModalVisible(false);
                  regenerateInstallmentsMutation.mutate();
                }}
              >
                <Text style={styles.confirmButtonText}>Regenerate</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Loading Overlay for Regeneration */}
      <Modal
        visible={regenerateInstallmentsMutation.isPending}
        transparent
        animationType="fade"
      >
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingCard, { backgroundColor: colors.card }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.text }]}>
              Regenerating Installments...
            </Text>
            <Text style={[styles.loadingSubtext, { color: colors.textMuted }]}>
              Please wait, this may take a few seconds
            </Text>
          </View>
        </View>
      </Modal>

      {/* BT Payment Modal */}
      <Modal
        visible={btPaymentModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setBtPaymentModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.formModalContent, { backgroundColor: colors.card }]}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
              <View style={[styles.btIcon, { backgroundColor: colors.primary + '20', marginBottom: 12, alignSelf: 'center' }]}>
                <Ionicons name="swap-horizontal" size={32} color={colors.primary} />
              </View>
              <Text style={[styles.formModalTitle, { color: colors.text, textAlign: 'center' }]}>Process BT Payment</Text>
              {selectedBtAllocation && (
                <Text style={[styles.formModalSubtitle, { color: colors.textMuted, textAlign: 'center' }]}>
                  Transfer to: {allLoans.find(l => l.id === selectedBtAllocation.targetLoanId)?.name || 'Unknown Loan'}
                </Text>
              )}

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Original Outstanding</Text>
              <View style={[styles.formInput, { backgroundColor: colors.background, borderColor: colors.border, justifyContent: 'center' }]}>
                <Text style={{ color: colors.textMuted, fontSize: 16 }}>
                  {formatCurrency(parseFloat(selectedBtAllocation?.originalOutstandingAmount || '0'))}
                </Text>
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>BT Amount *</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                value={btPaymentAmount}
                onChangeText={setBtPaymentAmount}
                keyboardType="numeric"
                placeholder="Enter actual BT amount"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Processing Fee (Optional)</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                value={btProcessingFee}
                onChangeText={setBtProcessingFee}
                keyboardType="numeric"
                placeholder="Any processing fee"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Payment Date</Text>
              <TouchableOpacity
                style={[styles.formInput, { backgroundColor: colors.background, borderColor: colors.border, justifyContent: 'center' }]}
                onPress={() => setShowBtDatePicker(true)}
              >
                <Text style={{ color: colors.text, fontSize: 16 }}>
                  {btPaymentDate.toLocaleDateString('en-IN')}
                </Text>
              </TouchableOpacity>
              {showBtDatePicker && (
                <DateTimePicker
                  value={btPaymentDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, selectedDate) => {
                    setShowBtDatePicker(Platform.OS === 'ios');
                    if (selectedDate) {
                      setBtPaymentDate(selectedDate);
                    }
                  }}
                />
              )}
            </View>
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton, { backgroundColor: colors.background }]}
                onPress={() => {
                  setBtPaymentModalVisible(false);
                  setSelectedBtAllocation(null);
                }}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton, { backgroundColor: colors.primary }]}
                onPress={handleProcessBtPayment}
                disabled={btPaymentMutation.isPending || !btPaymentAmount}
              >
                {btPaymentMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmButtonText}>Process BT</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <SpendingBreakdownModal
        loanId={loanId}
        visible={spendingBreakdownVisible}
        onClose={() => setSpendingBreakdownVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  outstandingCard: {
    margin: 16,
    padding: 20,
    borderRadius: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  outstandingContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  outstandingLabel: {
    color: '#fff',
    fontSize: 14,
    opacity: 0.9,
    marginBottom: 4,
  },
  outstandingAmount: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
  },
  outstandingLoanName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  typeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  typeBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  progressSection: {
    marginTop: 8,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  progressText: {
    color: '#fff',
    fontSize: 12,
    opacity: 0.9,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    padding: 12,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  statLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  existingLoanBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
  },
  existingLoanBannerTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  existingLoanBannerText: {
    fontSize: 12,
    lineHeight: 16,
  },
  lenderCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  lenderLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  lenderName: {
    fontSize: 16,
    fontWeight: '500',
  },
  accountNumber: {
    fontSize: 14,
    marginTop: 2,
  },
  loanActionsContainer: {
    marginHorizontal: 16,
    marginTop: 12,
    gap: 8,
  },
  loanActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  preclosureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  preclosureButtonContent: {
    flex: 1,
  },
  preclosureButtonTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  preclosureButtonSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  preclosedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  preclosedBannerContent: {
    flex: 1,
  },
  preclosedBannerTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  preclosedBannerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  formHint: {
    fontSize: 12,
    marginTop: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  toggleInfo: {
    flex: 1,
    marginRight: 12,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  toggleHint: {
    fontSize: 12,
  },
  toggleNote: {
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 0,
  },
  tab: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 16,
    fontWeight: '600',
  },
  tabContent: {
    padding: 16,
    gap: 8,
  },
  emptyCard: {
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
  installmentCard: {
    padding: 12,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  installmentLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  installmentInfo: {
    flex: 1,
  },
  installmentNumber: {
    fontSize: 14,
    fontWeight: '500',
  },
  installmentDate: {
    fontSize: 12,
    marginTop: 2,
  },
  installmentRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  installmentAmounts: {
    alignItems: 'flex-end',
  },
  installmentAmount: {
    fontSize: 14,
    fontWeight: '600',
  },
  installmentBreakdown: {
    fontSize: 10,
    marginTop: 2,
  },
  payButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
  },
  payButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    borderRadius: 8,
    gap: 8,
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  confirmButton: {},
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  tabsScrollView: {
    marginHorizontal: 16,
    marginTop: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  addRowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    gap: 6,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  swipeActionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  swipeActionButton: {
    width: 70,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    marginLeft: 4,
  },
  swipeActionText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  addRowButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  termCard: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  termHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  termIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  termInfo: {
    flex: 1,
  },
  termLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  termDate: {
    fontSize: 11,
    marginTop: 2,
  },
  termDetails: {
    flexDirection: 'row',
    gap: 16,
  },
  termStat: {
    flex: 1,
  },
  termStatLabel: {
    fontSize: 10,
  },
  termStatValue: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  termReason: {
    fontSize: 11,
    marginTop: 8,
    fontStyle: 'italic',
  },
  paymentCard: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  paymentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  paymentIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  paymentInfo: {
    flex: 1,
  },
  paymentType: {
    fontSize: 14,
    fontWeight: '500',
  },
  paymentDate: {
    fontSize: 11,
    marginTop: 2,
  },
  paymentAmount: {
    fontSize: 16,
    fontWeight: '700',
  },
  paymentBreakdown: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  paymentBreakdownText: {
    fontSize: 11,
  },
  paymentNotes: {
    fontSize: 11,
    marginTop: 6,
    fontStyle: 'italic',
  },
  formModalContent: {
    width: '90%',
    padding: 20,
    borderRadius: 16,
    maxHeight: '80%',
  },
  formModalTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 4,
  },
  formModalSubtitle: {
    fontSize: 13,
    marginBottom: 16,
  },
  formGroup: {
    marginBottom: 12,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 6,
  },
  formInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
  },
  formRow: {
    flexDirection: 'row',
    gap: 12,
  },
  paymentTypeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  paymentTypeButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  loadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingCard: {
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    minWidth: 200,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 16,
  },
  loadingSubtext: {
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  // BT Tab Styles
  btCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  btCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  btIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btInfo: {
    flex: 1,
  },
  btTargetName: {
    fontSize: 15,
    fontWeight: '600',
  },
  btLenderName: {
    fontSize: 12,
    marginTop: 2,
  },
  btPayButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btPayButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  btDetails: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
    gap: 8,
  },
  btDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  btDetailLabel: {
    fontSize: 13,
  },
  btDetailValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  btStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  btStatusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  effectOptions: {
    gap: 10,
  },
  effectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
  },
  effectOptionText: {
    flex: 1,
  },
  effectOptionTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  effectOptionSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  previewSection: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  previewLabel: {
    fontSize: 13,
  },
  previewValue: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  previewText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
});
