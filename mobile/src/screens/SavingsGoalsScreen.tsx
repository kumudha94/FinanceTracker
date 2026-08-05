import { useState, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, Modal, Switch, Platform } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import Toast from 'react-native-toast-message';
import { Swipeable } from 'react-native-gesture-handler';
import { formatCurrency, getThemedColors } from '../lib/utils';
import { api } from '../lib/api';
import type { SavingsGoal, Category } from '../lib/types';
import { useTheme } from '../contexts/ThemeContext';
import { MoreStackParamList } from '../../App';
import { useSwipeSettings } from '../hooks/useSwipeSettings';

type NavigationProp = NativeStackNavigationProp<MoreStackParamList>;

const GOAL_ICONS = ['flag', 'airplane', 'home', 'school', 'wallet', 'car', 'heart', 'trophy'];
const GOAL_COLORS = ['#4CAF50', '#2196F3', '#FF9800', '#E91E63', '#9C27B0', '#00BCD4', '#F44336', '#FFC107'];

export default function SavingsGoalsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const swipeSettings = useSwipeSettings();
  const swipeableRefs = useRef<Map<number, Swipeable>>(new Map());
  const currentOpenSwipeable = useRef<number | null>(null);

  const [activeTab, setActiveTab] = useState<'progress' | 'manage'>('progress');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isContributeModalOpen, setIsContributeModalOpen] = useState(false);
  const [isContributionsModalOpen, setIsContributionsModalOpen] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<SavingsGoal | null>(null);
  const [goalToEdit, setGoalToEdit] = useState<SavingsGoal | null>(null);
  const [newGoal, setNewGoal] = useState({ 
    name: '', 
    targetAmount: '', 
    icon: 'flag', 
    color: '#4CAF50',
    accountId: null as number | null,
    toAccountId: null as number | null,
    affectTransaction: true,
    affectAccountBalance: true,
    startDate: new Date(),
    targetDate: new Date(new Date().setMonth(new Date().getMonth() + 1)) // 1 month from today
  });
  const [contributionAmount, setContributionAmount] = useState('');
  const [contributionDate, setContributionDate] = useState(new Date());
  const [showContributionDatePicker, setShowContributionDatePicker] = useState(false);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showTargetDatePicker, setShowTargetDatePicker] = useState(false);
  const [showEditStartDatePicker, setShowEditStartDatePicker] = useState(false);
  const [showEditTargetDatePicker, setShowEditTargetDatePicker] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [goalToDelete, setGoalToDelete] = useState<SavingsGoal | null>(null);
  const [contributeCreateTransaction, setContributeCreateTransaction] = useState(true);
  const [contributeAffectBalance, setContributeAffectBalance] = useState(true);
  const [showFromAccountPicker, setShowFromAccountPicker] = useState(false);
  const [showToAccountPicker, setShowToAccountPicker] = useState(false);

  const { data: goals, isLoading, refetch: refetchGoals } = useQuery<SavingsGoal[]>({
    queryKey: ['/api/savings-goals'],
    queryFn: api.getSavingsGoals,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
    queryFn: api.getCategories,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['/api/accounts'],
    queryFn: api.getAccounts,
  });

  const activeAccounts = accounts.filter((acc: any) => acc.type === 'bank' && acc.isActive);
  const selectedFromAccount = activeAccounts.find((a: any) => a.id === newGoal.accountId);
  const selectedToAccount = activeAccounts.find((a: any) => a.id === newGoal.toAccountId);

  const { data: contributions = [], refetch: refetchContributions } = useQuery({
    queryKey: ['contributions', selectedGoal?.id],
    queryFn: () => selectedGoal ? api.getContributions(selectedGoal.id) : Promise.resolve([]),
    enabled: !!selectedGoal && isContributionsModalOpen,
  });

  // Refetch data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      refetchGoals();
      return () => {
        // Close all swipeables when leaving screen
        swipeableRefs.current.forEach(ref => ref?.close());
        currentOpenSwipeable.current = null;
      };
    }, [refetchGoals])
  );

  const createGoalMutation = useMutation({
    mutationFn: (data: { 
      name: string; 
      targetAmount: string; 
      icon: string; 
      color: string; 
      accountId?: number | null; 
      toAccountId?: number | null; 
      affectTransaction: boolean; 
      affectAccountBalance: boolean;
      startDate: string;
      targetDate: string;
      monthlyExpectedAmount?: string;
      status?: 'active' | 'completed' | 'cancelled';
    }) => api.createSavingsGoal(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/savings-goals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      setIsAddModalOpen(false);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setNewGoal({ 
        name: '', 
        targetAmount: '', 
        icon: 'flag', 
        color: '#4CAF50', 
        accountId: null, 
        toAccountId: null, 
        affectTransaction: true, 
        affectAccountBalance: true,
        startDate: new Date(),
        targetDate: new Date(new Date().setMonth(new Date().getMonth() + 1))
      });
      Toast.show({
        type: 'success',
        text1: 'Goal Created',
        text2: 'Your savings goal has been created',
        position: 'bottom',
      });
    },
    onError: (error) => {
      Toast.show({
        type: 'error',
        text1: 'Creation Failed',
        text2: 'Could not create goal. Please try again.',
        position: 'bottom',
      });
    },
  });

  const updateGoalMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<{ name: string; targetAmount: string; startDate: string; targetDate: string; icon: string; color: string; accountId?: number | null; toAccountId?: number | null; affectTransaction?: boolean; affectAccountBalance?: boolean; status?: 'active' | 'completed' | 'cancelled' }> }) =>
      api.updateSavingsGoal(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/savings-goals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      setIsEditModalOpen(false);
      setGoalToEdit(null);
      Toast.show({
        type: 'success',
        text1: 'Goal Updated',
        text2: 'Your savings goal has been updated',
        position: 'bottom',
      });
    },
    onError: (error) => {
      Toast.show({
        type: 'error',
        text1: 'Update Failed',
        text2: 'Could not update goal. Please try again.',
        position: 'bottom',
      });
    },
  });

  const addContributionMutation = useMutation({
    mutationFn: ({ goalId, amount, contributedAt, createTransaction, affectBalance }: { goalId: number; amount: string; contributedAt?: string; createTransaction: boolean; affectBalance: boolean }) =>
      api.addContribution(goalId, { amount, contributedAt, createTransaction, affectBalance }),
    onSuccess: async (_, variables) => {
      // Refetch the updated goal to get new current amount
      await queryClient.invalidateQueries({ queryKey: ['/api/savings-goals'] });
      
      // Get the updated goal and recalculate monthly expected amount
      const updatedGoals = await queryClient.fetchQuery({ queryKey: ['/api/savings-goals'] });
      const updatedGoal = (updatedGoals as any[])?.find(g => g.id === variables.goalId);
      
      if (updatedGoal && updatedGoal.targetDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const targetDate = new Date(updatedGoal.targetDate);
        targetDate.setHours(0, 0, 0, 0);
        
        // Calculate remaining amount
        const remainingAmount = parseFloat(updatedGoal.targetAmount) - parseFloat(updatedGoal.currentAmount || '0');
        
        // Calculate remaining months from today to target date
        const monthsDiff = (targetDate.getFullYear() - today.getFullYear()) * 12 + 
                           (targetDate.getMonth() - today.getMonth());
        
        if (monthsDiff > 0 && remainingAmount > 0) {
          const newMonthlyAmount = (remainingAmount / monthsDiff).toFixed(2);
          
          // Update the goal with new monthly expected amount
          await api.updateSavingsGoal(updatedGoal.id, { 
            monthlyExpectedAmount: newMonthlyAmount 
          });
        } else if (remainingAmount <= 0) {
          // Goal is completed, set monthly to 0
          await api.updateSavingsGoal(updatedGoal.id, { 
            monthlyExpectedAmount: "0" 
          });
        }
      }
      
      queryClient.invalidateQueries({ queryKey: ['/api/savings-goals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/monthlyExpenses'] });
      queryClient.invalidateQueries({ queryKey: ['categoryBreakdown'] });
      setIsContributeModalOpen(false);
      setContributionAmount('');
      setSelectedGoal(null);
      setContributionDate(new Date());
      setContributeCreateTransaction(true);
      setContributeAffectBalance(true);
      Toast.show({
        type: 'success',
        text1: 'Contribution Added',
        text2: 'Your contribution has been recorded',
        position: 'bottom',
      });
    },
    onError: (error) => {
      Toast.show({
        type: 'error',
        text1: 'Contribution Failed',
        text2: 'Could not add contribution. Please try again.',
        position: 'bottom',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'active' | 'completed' | 'cancelled' }) =>
      api.updateSavingsGoal(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/savings-goals'] });
      Toast.show({
        type: 'success',
        text1: 'Goal Updated',
        text2: 'Savings goal status has been updated',
        position: 'bottom',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await api.deleteSavingsGoal(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/savings-goals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      refetchGoals();
      Toast.show({
        type: 'success',
        text1: 'Goal Deleted',
        text2: 'Savings goal has been removed',
        position: 'bottom',
      });
    },
    onError: (error) => {
      Toast.show({
        type: 'error',
        text1: 'Delete Failed',
        text2: 'Could not delete goal. Please try again.',
        position: 'bottom',
      });
    },
  });

  const deleteContributionMutation = useMutation({
    mutationFn: async (id: number) => {
      return await api.deleteContribution(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/savings-goals'] });
      queryClient.invalidateQueries({ queryKey: ['contributions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      refetchGoals();
      refetchContributions();
      Toast.show({
        type: 'success',
        text1: 'Contribution Deleted',
        text2: 'Contribution has been removed',
        position: 'bottom',
      });
    },
    onError: (error) => {
      Toast.show({
        type: 'error',
        text1: 'Delete Failed',
        text2: 'Could not delete contribution. Please try again.',
        position: 'bottom',
      });
    },
  });

  const handleDelete = (goal: SavingsGoal) => {
    setGoalToDelete(goal);
    setShowDeleteModal(true);
  };

  const confirmDelete = () => {
    if (goalToDelete) {
      // Close the swipeable before deleting
      if (currentOpenSwipeable.current !== null) {
        swipeableRefs.current.get(currentOpenSwipeable.current)?.close();
        currentOpenSwipeable.current = null;
      }
      deleteMutation.mutate(goalToDelete.id);
      setShowDeleteModal(false);
      setGoalToDelete(null);
    }
  };

  const cancelDelete = () => {
    // Close the swipeable when canceling
    if (currentOpenSwipeable.current !== null) {
      swipeableRefs.current.get(currentOpenSwipeable.current)?.close();
      currentOpenSwipeable.current = null;
    }
    setShowDeleteModal(false);
    setGoalToDelete(null);
  };

  const toggleStatus = (goal: SavingsGoal) => {
    const newStatus = goal.status === 'active' ? 'cancelled' : 'active';
    updateMutation.mutate({
      id: goal.id,
      status: newStatus,
    });
  };

  const calculateProgress = (current: string, target: string) => {
    const currentNum = parseFloat(current || '0');
    const targetNum = parseFloat(target);
    return Math.min((currentNum / targetNum) * 100, 100);
  };

  const calculateMonthlyExpectedAmount = (startDate: Date, targetDate: Date, targetAmount: string): string => {
    const start = new Date(startDate);
    const end = new Date(targetDate);
    
    // Calculate months difference
    const monthsDiff = (end.getFullYear() - start.getFullYear()) * 12 + 
                       (end.getMonth() - start.getMonth());
    
    if (monthsDiff <= 0) return "0";
    
    const amount = parseFloat(targetAmount);
    const monthlyAmount = amount / monthsDiff;
    
    return monthlyAmount.toFixed(2);
  };

  const handleEdit = (goal: SavingsGoal) => {
    // Close the swipeable before opening modal
    if (currentOpenSwipeable.current !== null) {
      swipeableRefs.current.get(currentOpenSwipeable.current)?.close();
      currentOpenSwipeable.current = null;
    }
    setGoalToEdit(goal);
    setIsEditModalOpen(true);
  };

  const renderRightActions = (goal: SavingsGoal) => {
    const action = swipeSettings.rightAction;
    return (
      <TouchableOpacity
        style={[styles.swipeAction, { backgroundColor: action === 'edit' ? colors.primary : '#ef4444' }]}
        onPress={() => action === 'edit' ? handleEdit(goal) : handleDelete(goal)}
      >
        <Ionicons name={action === 'edit' ? 'pencil' : 'trash-outline'} size={24} color="#fff" />
        <Text style={styles.swipeActionText}>{action === 'edit' ? 'Edit' : 'Delete'}</Text>
      </TouchableOpacity>
    );
  };

  const renderLeftActions = (goal: SavingsGoal) => {
    const action = swipeSettings.leftAction;
    return (
      <TouchableOpacity
        style={[styles.swipeAction, { backgroundColor: action === 'edit' ? colors.primary : '#ef4444' }]}
        onPress={() => action === 'edit' ? handleEdit(goal) : handleDelete(goal)}
      >
        <Ionicons name={action === 'edit' ? 'pencil' : 'trash-outline'} size={24} color="#fff" />
        <Text style={styles.swipeActionText}>{action === 'edit' ? 'Edit' : 'Delete'}</Text>
      </TouchableOpacity>
    );
  };

  const activeGoals = goals?.filter(g => g.status === 'active') || [];
  const completedGoals = goals?.filter(g => g.status === 'completed') || [];
  
  const totalTarget = activeGoals.reduce((sum, g) => sum + parseFloat(g.targetAmount), 0);
  const totalSaved = activeGoals.reduce((sum, g) => sum + parseFloat(g.currentAmount || '0'), 0);
  const totalExpectedMonthly = activeGoals.reduce((sum, g) => {
    // Use stored value if available, otherwise calculate on-the-fly
    let monthlyAmount = parseFloat(g.monthlyExpectedAmount || '0');
    if (monthlyAmount === 0 && g.startDate && g.targetDate) {
      monthlyAmount = parseFloat(calculateMonthlyExpectedAmount(
        new Date(g.startDate),
        new Date(g.targetDate),
        g.targetAmount
      ));
    }
    return sum + monthlyAmount;
  }, 0);

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      
      {/* Tabs */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'progress' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('progress')}
        >
          <Text style={[styles.tabText, { color: activeTab === 'progress' ? colors.primary : colors.textMuted }]}>
            Progress
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'manage' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('manage')}
        >
          <Text style={[styles.tabText, { color: activeTab === 'manage' ? colors.primary : colors.textMuted }]}>
            All Goals
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {activeTab === 'progress' ? (
          <View style={styles.tabContent}>
            {/* Total Card */}
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Total Saved from {activeGoals.length} active goals</Text>
              <Text style={styles.totalValue}>{formatCurrency(totalSaved)}</Text>
              <Text style={[styles.totalSubtitle]}>of {formatCurrency(totalTarget)} target</Text>
              {totalExpectedMonthly > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8, gap: 6 }}>
                  <Ionicons name="calendar-outline" size={14} color="#fff" />
                  <Text style={[styles.totalSubtitle, { color: '#fff', opacity: 1, fontWeight: '600' }]}>
                    ₹{totalExpectedMonthly.toFixed(2)}/month expected
                  </Text>
                </View>
              )}
              <View style={styles.totalProgressBar}>
                <View 
                  style={[
                    styles.totalProgressFill, 
                    { width: `${totalTarget > 0 ? (totalSaved / totalTarget) * 100 : 0}%` }
                  ]} 
                />
              </View>
            </View>

            {/* Active Goals */}
            {activeGoals.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
                <Ionicons name="trophy-outline" size={48} color={colors.textMuted} />
                <Text style={[styles.emptyText, { color: colors.text }]}>No active savings goals</Text>
                <TouchableOpacity
                  style={[styles.addFirstButton, { backgroundColor: colors.primary }]}
                  onPress={() => setIsAddModalOpen(true)}
                >
                  <Ionicons name="add" size={20} color="#fff" />
                  <Text style={styles.addFirstButtonText}>Add Your First Goal</Text>
                </TouchableOpacity>
              </View>
            ) : (
              activeGoals.map((goal) => {
                const progress = calculateProgress(goal.currentAmount, goal.targetAmount);
                const remaining = parseFloat(goal.targetAmount) - parseFloat(goal.currentAmount || '0');
                const targetDate = goal.targetDate ? new Date(goal.targetDate) : null;
                const isOverdue = targetDate && targetDate < new Date() && goal.status !== 'completed';

                return (
                  <View 
                    key={goal.id} 
                    style={[
                      styles.goalCard, 
                      { backgroundColor: colors.card },
                      isOverdue && { borderColor: '#ef4444', borderWidth: 1 }
                    ]}
                  >
                    <View style={styles.goalHeader}>
                      <View style={[styles.goalIcon, { backgroundColor: goal.color || colors.primary }]}>
                        <Ionicons name={(goal.icon as any) || 'flag'} size={24} color="#fff" />
                      </View>
                      <View style={styles.goalInfo}>
                        <View style={styles.goalNameRow}>
                          <Text style={[styles.goalName, { color: colors.text }]}>
                            {goal.name}
                          </Text>
                          {isOverdue && (
                            <View style={styles.overdueBadge}>
                              <Text style={styles.overdueText}>Overdue</Text>
                            </View>
                          )}
                        </View>
                        <Text style={[styles.goalDetails, { color: colors.textMuted }]}>
                          {formatCurrency(parseFloat(goal.currentAmount || '0'))} of {formatCurrency(parseFloat(goal.targetAmount))}
                          {targetDate && ` • Due ${targetDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                        </Text>
                        {/* New Impact Indicators */}
                        <View style={styles.impactContainer}>
                          {goal.affectAccountBalance && (
                            <View style={[styles.impactBadge, { backgroundColor: colors.primary + '15' }]}>
                              <Ionicons name="wallet-outline" size={12} color={colors.primary} />
                              <Text style={[styles.impactText, { color: colors.primary }]}>Updates Balance</Text>
                            </View>
                          )}
                          
                          {goal.affectTransaction && (
                            <View style={[styles.impactBadge, { backgroundColor: colors.textMuted + '15' }]}>
                              <Ionicons name="receipt-outline" size={12} color={colors.textMuted} />
                              <Text style={[styles.impactText, { color: colors.textMuted }]}>Creates Txn</Text>
                            </View>
                          )}
                        </View>
                        <View style={styles.progressBarContainer}>
                          <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                            <View 
                              style={[
                                styles.progressBarFill, 
                                { backgroundColor: colors.primary, width: `${progress}%` }
                              ]} 
                            />
                          </View>
                          <Text style={[styles.progressPercent, { color: colors.textMuted }]}>
                            {progress.toFixed(0)}%
                          </Text>
                        </View>
                        {/* Date Range */}
                        <View style={styles.dateRangeContainer}>
                          <View style={styles.dateItem}>
                            <Text style={[styles.dateLabel, { color: colors.textMuted }]}>From:</Text>
                            <Text style={[styles.dateValue, { color: colors.text }]}>
                              {goal.startDate ? new Date(goal.startDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}
                            </Text>
                          </View>
                          <View style={styles.dateItem}>
                            <Text style={[styles.dateLabel, { color: colors.textMuted }]}>To:</Text>
                            <Text style={[styles.dateValue, { color: colors.text }]}>
                              {goal.targetDate ? new Date(goal.targetDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>
                    <View style={styles.goalActions}>
                      <TouchableOpacity
                        style={[styles.contributeButton, { backgroundColor: `${colors.primary}20` }]}
                        onPress={() => {
                          setSelectedGoal(goal);
                          setContributeCreateTransaction(goal.affectTransaction ?? true);
                          setContributeAffectBalance(goal.affectAccountBalance ?? true);
                          setIsContributeModalOpen(true);
                        }}
                      >
                        <Text style={[styles.contributeButtonText, { color: colors.primary }]}>
                          Add Money
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.viewButton, { borderColor: colors.border }]}
                        onPress={() => {
                          setSelectedGoal(goal);
                          setIsContributionsModalOpen(true);
                        }}
                      >
                        <Text style={[styles.viewButtonText, { color: colors.text }]}>
                          Contributions
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}

            {/* Completed Goals */}
            {completedGoals.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Completed Goals</Text>
                {completedGoals.map((goal) => (
                  <View 
                    key={goal.id} 
                    style={[styles.completedCard, { backgroundColor: colors.card }]}
                  >
                    <Ionicons name="checkmark-circle" size={24} color="#16a34a" />
                    <View style={styles.completedInfo}>
                      <Text style={[styles.completedName, { color: colors.text }]}>
                        {goal.name}
                      </Text>
                      <Text style={[styles.completedAmount, { color: colors.textMuted }]}>
                        {formatCurrency(parseFloat(goal.targetAmount))}
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            )}
          </View>
        ) : (
          <View style={styles.tabContent}>
            {/* All Goals */}
            {goals && goals.length > 0 ? (
              goals.map((goal) => {
                const isActive = goal.status === 'active';
                const progress = calculateProgress(goal.currentAmount, goal.targetAmount);

                const isWeb = Platform.OS === 'web';
                const showActionButtons = isWeb || !swipeSettings.enabled;
                const content = (
                  <View
                    style={[
                      styles.manageCard,
                      { backgroundColor: colors.card },
                      !isActive && styles.manageCardInactive
                    ]}
                  >
                    <View style={styles.manageHeader}>
                      <View style={[styles.smallIcon, { backgroundColor: goal.color || colors.primary }]}>
                        <Ionicons name={(goal.icon as any) || 'flag'} size={20} color="#fff" />
                      </View>
                      <View style={styles.manageInfo}>
                        <Text style={[styles.manageName, { color: colors.text }, !isActive && { color: colors.textMuted }]}>
                          {goal.name}
                        </Text>
                        <Text style={[styles.manageAmount, { color: colors.textMuted }]}>
                          {formatCurrency(parseFloat(goal.currentAmount || '0'))} / {formatCurrency(parseFloat(goal.targetAmount))}
                        </Text>
                        <View style={[styles.smallProgressBar, { backgroundColor: colors.border }]}>
                          <View 
                            style={[
                              styles.smallProgressFill, 
                              { backgroundColor: colors.primary, width: `${progress}%` }
                            ]} 
                          />
                        </View>
                        {/* Date Range */}
                        <View style={styles.dateRangeContainer}>
                          <View style={styles.dateItem}>
                            <Text style={[styles.dateLabel, { color: colors.textMuted }]}>From:</Text>
                            <Text style={[styles.dateValue, { color: colors.text }]}>
                              {goal.startDate ? new Date(goal.startDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}
                            </Text>
                          </View>
                          <View style={styles.dateItem}>
                            <Text style={[styles.dateLabel, { color: colors.textMuted }]}>To:</Text>
                            <Text style={[styles.dateValue, { color: colors.text }]}>
                              {goal.targetDate ? new Date(goal.targetDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}
                            </Text>
                          </View>
                        </View>
                      </View>
                      <View style={styles.manageActions}>
                        <View style={styles.statusBadge}>
                          <Text style={[styles.statusText, { color: colors.textMuted }]}>
                            {goal.status}
                          </Text>
                        </View>
                        <Switch
                          value={isActive}
                          onValueChange={() => toggleStatus(goal)}
                          trackColor={{ false: colors.border, true: `${colors.primary}80` }}
                          thumbColor={isActive ? colors.primary : colors.textMuted}
                        />
                      </View>
                    </View>
                    {showActionButtons && (
                      <View style={styles.webActions}>
                        <TouchableOpacity
                          style={[styles.webActionButton, { backgroundColor: colors.primary }]}
                          onPress={() => handleEdit(goal)}
                        >
                          <Ionicons name="pencil" size={18} color="#fff" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.webActionButton, { backgroundColor: '#ef4444' }]}
                          onPress={() => handleDelete(goal)}
                        >
                          <Ionicons name="trash-outline" size={18} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );

                // Disable swipe on web as react-native-gesture-handler doesn't support it
                const isSwipeEnabled = swipeSettings.enabled && Platform.OS !== 'web';
                
                if (isSwipeEnabled) {
                  return (
                    <Swipeable
                      key={goal.id}
                      ref={(ref) => {
                        if (ref) {
                          swipeableRefs.current.set(goal.id, ref);
                        } else {
                          swipeableRefs.current.delete(goal.id);
                        }
                      }}
                      renderRightActions={() => renderRightActions(goal)}
                      renderLeftActions={() => renderLeftActions(goal)}
                      onSwipeableOpen={() => {
                        // Close previously opened swipeable
                        if (currentOpenSwipeable.current !== null && currentOpenSwipeable.current !== goal.id) {
                          swipeableRefs.current.get(currentOpenSwipeable.current)?.close();
                        }
                        currentOpenSwipeable.current = goal.id;
                      }}
                    >
                      {content}
                    </Swipeable>
                  );
                }

                return <View key={goal.id}>{content}</View>;
              })
            ) : (
              <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
                <Ionicons name="flag-outline" size={48} color={colors.textMuted} />
                <Text style={[styles.emptyText, { color: colors.text }]}>No savings goals yet</Text>
                <TouchableOpacity
                  style={[styles.addFirstButton, { backgroundColor: colors.primary }]}
                  onPress={() => setIsAddModalOpen(true)}
                >
                  <Ionicons name="add" size={20} color="#fff" />
                  <Text style={styles.addFirstButtonText}>Create Your First Goal</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => setIsAddModalOpen(true)}
        activeOpacity={0.8}
        accessibilityLabel="Add new savings goal"
        accessibilityRole="button"
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Add Goal Modal */}
      <Modal
        visible={isAddModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsAddModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Create Savings Goal</Text>
              <TouchableOpacity onPress={() => setIsAddModalOpen(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalBody}>
              <Text style={[styles.label, { color: colors.text }]}>Goal Name</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                placeholder="e.g., Vacation Fund"
                placeholderTextColor={colors.textMuted}
                value={newGoal.name}
                onChangeText={(text) => setNewGoal({ ...newGoal, name: text })}
              />

              <Text style={[styles.label, { color: colors.text }]}>Target Amount (₹)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                placeholder="50000"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                value={newGoal.targetAmount}
                onChangeText={(text) => setNewGoal({ ...newGoal, targetAmount: text })}
              />

              {/* Show monthly expected amount */}
              {newGoal.targetAmount && parseFloat(newGoal.targetAmount) > 0 && (() => {
                const monthlyAmount = calculateMonthlyExpectedAmount(newGoal.startDate, newGoal.targetDate, newGoal.targetAmount);
                if (parseFloat(monthlyAmount) > 0) {
                  return (
                    <View style={[styles.infoBox, { backgroundColor: colors.primary + '15', borderColor: colors.primary, marginTop: 8 }]}>
                      <Ionicons name="calculator-outline" size={16} color={colors.primary} />
                      <Text style={[styles.infoText, { color: colors.primary }]}>Monthly savings needed: ₹{monthlyAmount}</Text>
                    </View>
                  );
                }
                return null;
              })()}

              <Text style={[styles.label, { color: colors.text }]}>Start Date *</Text>
              <TouchableOpacity
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
                onPress={() => setShowStartDatePicker(true)}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
                  <Text style={{ color: colors.text }}>
                    {newGoal.startDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                </View>
                <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
              </TouchableOpacity>
              {(() => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const selectedDate = new Date(newGoal.startDate);
                selectedDate.setHours(0, 0, 0, 0);
                if (selectedDate > today) {
                  return (
                    <View style={[styles.infoBox, { backgroundColor: colors.primary + '15', borderColor: colors.primary }]}>
                      <Ionicons name="information-circle" size={16} color={colors.primary} />
                      <Text style={[styles.infoText, { color: colors.primary }]}>
                        You need to manually activate the goal on this day
                      </Text>
                    </View>
                  );
                }
                return null;
              })()}
              {showStartDatePicker && (
                <DateTimePicker
                  value={newGoal.startDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, selectedDate) => {
                    setShowStartDatePicker(Platform.OS === 'ios');
                    if (selectedDate) {
                      setNewGoal({ ...newGoal, startDate: selectedDate });
                    }
                  }}
                />
              )}

              <Text style={[styles.label, { color: colors.text }]}>Target Date *</Text>
              <TouchableOpacity
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
                onPress={() => setShowTargetDatePicker(true)}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
                  <Text style={{ color: colors.text }}>
                    {newGoal.targetDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                </View>
                <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
              </TouchableOpacity>
              {showTargetDatePicker && (
                <DateTimePicker
                  value={newGoal.targetDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  minimumDate={new Date()} // Cannot select past dates
                  onChange={(event, selectedDate) => {
                    setShowTargetDatePicker(Platform.OS === 'ios');
                    if (selectedDate) {
                      setNewGoal({ ...newGoal, targetDate: selectedDate });
                    }
                  }}
                />
              )}

              <Text style={[styles.label, { color: colors.text }]}>From Account *</Text>
              <TouchableOpacity
                style={[styles.dropdownButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => setShowFromAccountPicker(!showFromAccountPicker)}
              >
                <Ionicons name="wallet-outline" size={20} color={colors.textMuted} />
                <Text style={[styles.dropdownText, { color: selectedFromAccount ? colors.text : colors.textMuted }]}>
                  {selectedFromAccount ? selectedFromAccount.name : 'Select Account'}
                </Text>
              </TouchableOpacity>
              {showFromAccountPicker && activeAccounts && (
                <View style={[styles.dropdownList, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {activeAccounts.map((account: any) => (
                    <TouchableOpacity
                      key={account.id}
                      style={styles.dropdownItem}
                      onPress={() => { setNewGoal({ ...newGoal, accountId: account.id }); setShowFromAccountPicker(false); }}
                    >
                      <View style={[styles.accountIconSmall, { backgroundColor: account.color || colors.primary }]}>
                        <Ionicons name={(account.icon as any) || 'wallet'} size={16} color="#fff" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.dropdownItemText, { color: colors.text }]}>{account.name}</Text>
                        <Text style={[styles.dropdownItemSubtext, { color: colors.textMuted }]}>
                          {formatCurrency(parseFloat(account.balance || '0'))}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={[styles.label, { color: colors.text }]}>To Account (Optional)</Text>
              <TouchableOpacity
                style={[styles.dropdownButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => setShowToAccountPicker(!showToAccountPicker)}
              >
                <Ionicons name="wallet-outline" size={20} color={colors.textMuted} />
                <Text style={[styles.dropdownText, { color: selectedToAccount ? colors.text : colors.textMuted }]}>
                  {selectedToAccount ? selectedToAccount.name : 'None'}
                </Text>
              </TouchableOpacity>
              {showToAccountPicker && (
                <View style={[styles.dropdownList, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <TouchableOpacity
                    style={styles.dropdownItem}
                    onPress={() => { setNewGoal({ ...newGoal, toAccountId: null }); setShowToAccountPicker(false); }}
                  >
                    <View style={[styles.accountIconSmall, { backgroundColor: colors.textMuted }]}>
                      <Ionicons name="close" size={16} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.dropdownItemText, { color: colors.text }]}>None</Text>
                    </View>
                  </TouchableOpacity>
                  {activeAccounts.filter((acc: any) => acc.id !== newGoal.accountId).map((account: any) => (
                    <TouchableOpacity
                      key={account.id}
                      style={styles.dropdownItem}
                      onPress={() => { setNewGoal({ ...newGoal, toAccountId: account.id }); setShowToAccountPicker(false); }}
                    >
                      <View style={[styles.accountIconSmall, { backgroundColor: account.color || colors.primary }]}>
                        <Ionicons name={(account.icon as any) || 'wallet'} size={16} color="#fff" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.dropdownItemText, { color: colors.text }]}>{account.name}</Text>
                        <Text style={[styles.dropdownItemSubtext, { color: colors.textMuted }]}>
                          {formatCurrency(parseFloat(account.balance || '0'))}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={[styles.label, { color: colors.text }]}>Icon</Text>
              <View style={styles.iconGrid}>
                {GOAL_ICONS.map((icon) => (
                  <TouchableOpacity
                    key={icon}
                    style={[
                      styles.iconButton,
                      { borderColor: colors.border },
                      newGoal.icon === icon && { borderColor: colors.primary, backgroundColor: `${colors.primary}20` }
                    ]}
                    onPress={() => setNewGoal({ ...newGoal, icon })}
                  >
                    <Ionicons name={icon as any} size={24} color={newGoal.icon === icon ? colors.primary : colors.text} />
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.label, { color: colors.text }]}>Color</Text>
              <View style={styles.colorGrid}>
                {GOAL_COLORS.map((color) => (
                  <TouchableOpacity
                    key={color}
                    style={[
                      styles.colorButton,
                      { backgroundColor: color },
                      newGoal.color === color && styles.colorButtonSelected
                    ]}
                    onPress={() => setNewGoal({ ...newGoal, color })}
                  >
                    {newGoal.color === color && (
                      <Ionicons name="checkmark" size={20} color="#fff" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.toggleContainer}>
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.toggleLabel, { color: colors.text }]}>Create Transaction</Text>
                    <Text style={[styles.toggleDescription, { color: colors.textMuted }]}>
                      Add to transaction history when contributed
                    </Text>
                  </View>
                  <Switch
                    value={newGoal.affectTransaction}
                    onValueChange={(value) => setNewGoal({ ...newGoal, affectTransaction: value })}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>

                <View style={styles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.toggleLabel, { color: colors.text }]}>Affect Account Balance</Text>
                    <Text style={[styles.toggleDescription, { color: colors.textMuted }]}>
                      Update account balance when contributed
                    </Text>
                  </View>
                  <Switch
                    value={newGoal.affectAccountBalance}
                    onValueChange={(value) => setNewGoal({ ...newGoal, affectAccountBalance: value })}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[
                  styles.submitButton, 
                  { backgroundColor: colors.primary },
                  (!newGoal.name || !newGoal.targetAmount || !newGoal.accountId || createGoalMutation.isPending) && styles.submitButtonDisabled
                ]}
                onPress={() => {
                  if (newGoal.name && newGoal.targetAmount && newGoal.accountId && !createGoalMutation.isPending) {
                    // Validate dates
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const startDate = new Date(newGoal.startDate);
                    startDate.setHours(0, 0, 0, 0);
                    const targetDate = new Date(newGoal.targetDate);
                    targetDate.setHours(0, 0, 0, 0);

                    // Check if target date is in the past
                    if (targetDate < today) {
                      Toast.show({
                        type: 'error',
                        text1: 'Invalid Date',
                        text2: 'Target date cannot be in the past',
                        position: 'bottom',
                      });
                      return;
                    }

                    // Check if start date is before target date
                    if (startDate >= targetDate) {
                      Toast.show({
                        type: 'error',
                        text1: 'Invalid Date',
                        text2: 'Start date must be before target date',
                        position: 'bottom',
                      });
                      return;
                    }

                    // Calculate monthly expected amount
                    const monthlyExpectedAmount = calculateMonthlyExpectedAmount(
                      newGoal.startDate,
                      newGoal.targetDate,
                      newGoal.targetAmount
                    );

                    // Determine status based on start date (reuse already declared variables)
                    const initialStatus = startDate > today ? 'inactive' : 'active';

                    // Create goal with dates
                    const goalData = {
                      ...newGoal,
                      startDate: newGoal.startDate.toISOString(),
                      targetDate: newGoal.targetDate.toISOString(),
                      monthlyExpectedAmount,
                      status: initialStatus as const
                    };

                    createGoalMutation.mutate(goalData);
                  }
                }}
                disabled={!newGoal.name || !newGoal.targetAmount || !newGoal.accountId || createGoalMutation.isPending}
              >
                {createGoalMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitButtonText}>Create Goal</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Edit Goal Modal */}
      <Modal
        visible={isEditModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setIsEditModalOpen(false);
          setGoalToEdit(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Savings Goal</Text>
              <TouchableOpacity onPress={() => {
                setIsEditModalOpen(false);
                setGoalToEdit(null);
              }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalBody}>
              <Text style={[styles.label, { color: colors.text }]}>Goal Name</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                placeholder="e.g., Vacation Fund"
                placeholderTextColor={colors.textMuted}
                value={goalToEdit?.name || ''}
                onChangeText={(text) => goalToEdit && setGoalToEdit({ ...goalToEdit, name: text })}
              />

              <Text style={[styles.label, { color: colors.text }]}>Target Amount (₹)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                placeholder="50000"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                value={goalToEdit?.targetAmount || ''}
                onChangeText={(text) => goalToEdit && setGoalToEdit({ ...goalToEdit, targetAmount: text })}
              />

              <Text style={[styles.label, { color: colors.text }]}>Start Date *</Text>
              <TouchableOpacity
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
                onPress={() => setShowEditStartDatePicker(true)}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
                  <Text style={{ color: colors.text }}>
                    {goalToEdit?.startDate ? new Date(goalToEdit.startDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Select date'}
                  </Text>
                </View>
                <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
              </TouchableOpacity>
              {(() => {
                if (!goalToEdit?.startDate) return null;
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const selectedDate = new Date(goalToEdit.startDate);
                selectedDate.setHours(0, 0, 0, 0);
                if (selectedDate > today) {
                  return (
                    <View style={[styles.infoBox, { backgroundColor: colors.primary + '15', borderColor: colors.primary }]}>
                      <Ionicons name="information-circle" size={16} color={colors.primary} />
                      <Text style={[styles.infoText, { color: colors.primary }]}>
                        You need to manually activate the goal on this day
                      </Text>
                    </View>
                  );
                }
                return null;
              })()}
              {goalToEdit && showEditStartDatePicker && (
                <DateTimePicker
                  value={goalToEdit.startDate ? new Date(goalToEdit.startDate) : new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, selectedDate) => {
                    setShowEditStartDatePicker(Platform.OS === 'ios');
                    if (selectedDate && goalToEdit) {
                      setGoalToEdit({ ...goalToEdit, startDate: selectedDate.toISOString() });
                    }
                  }}
                />
              )}

              <Text style={[styles.label, { color: colors.text }]}>Target Date *</Text>
              <TouchableOpacity
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
                onPress={() => setShowEditTargetDatePicker(true)}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
                  <Text style={{ color: colors.text }}>
                    {goalToEdit?.targetDate ? new Date(goalToEdit.targetDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Select date'}
                  </Text>
                </View>
                <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
              </TouchableOpacity>
              {goalToEdit && showEditTargetDatePicker && (
                <DateTimePicker
                  value={goalToEdit.targetDate ? new Date(goalToEdit.targetDate) : new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  minimumDate={new Date()}
                  onChange={(event, selectedDate) => {
                    setShowEditTargetDatePicker(Platform.OS === 'ios');
                    if (selectedDate && goalToEdit) {
                      setGoalToEdit({ ...goalToEdit, targetDate: selectedDate.toISOString() });
                    }
                  }}
                />
              )}

              {/* Show monthly expected amount in Edit mode */}
              {goalToEdit?.targetAmount && parseFloat(goalToEdit.targetAmount) > 0 && goalToEdit?.startDate && goalToEdit?.targetDate && (() => {
                const monthlyAmount = calculateMonthlyExpectedAmount(
                  new Date(goalToEdit.startDate),
                  new Date(goalToEdit.targetDate),
                  goalToEdit.targetAmount
                );
                if (parseFloat(monthlyAmount) > 0) {
                  return (
                    <View style={[styles.infoBox, { backgroundColor: colors.primary + '15', borderColor: colors.primary, marginTop: 8 }]}>
                      <Ionicons name="calculator-outline" size={16} color={colors.primary} />
                      <Text style={[styles.infoText, { color: colors.primary }]}>Monthly savings needed: ₹{monthlyAmount}</Text>
                    </View>
                  );
                }
                return null;
              })()}

              <Text style={[styles.label, { color: colors.text }]}>From Account (Cannot be changed)</Text>
              <View style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', opacity: 0.7 }]}>
                {(() => {
                  const fromAccount = accounts.find((acc: any) => acc.id === goalToEdit?.accountId);
                  if (fromAccount) {
                    return (
                      <>
                        <View style={[styles.accountIcon, { backgroundColor: fromAccount.color || colors.primary, marginRight: 12 }]}>
                          <Ionicons name={(fromAccount.icon as any) || 'wallet'} size={16} color="#fff" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[{ color: colors.text, fontSize: 14, fontWeight: '600' }]}>
                            {fromAccount.name}
                          </Text>
                          <Text style={[{ color: colors.textMuted, fontSize: 12 }]}>
                            {formatCurrency(parseFloat(fromAccount.balance || '0'))}
                          </Text>
                        </View>
                      </>
                    );
                  }
                  return <Text style={[{ color: colors.textMuted }]}>No account selected</Text>;
                })()}
              </View>

              <Text style={[styles.label, { color: colors.text }]}>To Account (Cannot be changed)</Text>
              <View style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', opacity: 0.7 }]}>
                {(() => {
                  if (goalToEdit?.toAccountId === null || goalToEdit?.toAccountId === undefined) {
                    return (
                      <>
                        <View style={[styles.accountIcon, { backgroundColor: colors.textMuted, marginRight: 12 }]}>
                          <Ionicons name="close" size={16} color="#fff" />
                        </View>
                        <Text style={[{ color: colors.text, fontSize: 14 }]}>None</Text>
                      </>
                    );
                  }
                  const toAccount = accounts.find((acc: any) => acc.id === goalToEdit?.toAccountId);
                  if (toAccount) {
                    return (
                      <>
                        <View style={[styles.accountIcon, { backgroundColor: toAccount.color || colors.primary, marginRight: 12 }]}>
                          <Ionicons name={(toAccount.icon as any) || 'wallet'} size={16} color="#fff" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[{ color: colors.text, fontSize: 14, fontWeight: '600' }]}>
                            {toAccount.name}
                          </Text>
                          <Text style={[{ color: colors.textMuted, fontSize: 12 }]}>
                            {formatCurrency(parseFloat(toAccount.balance || '0'))}
                          </Text>
                        </View>
                      </>
                    );
                  }
                  return <Text style={[{ color: colors.textMuted }]}>No account selected</Text>;
                })()}
              </View>

              <Text style={[styles.label, { color: colors.text }]}>Icon</Text>
              <View style={styles.iconGrid}>
                {GOAL_ICONS.map((icon) => (
                  <TouchableOpacity
                    key={icon}
                    style={[
                      styles.iconButton,
                      { borderColor: colors.border },
                      goalToEdit?.icon === icon && { borderColor: colors.primary, backgroundColor: `${colors.primary}20` }
                    ]}
                    onPress={() => goalToEdit && setGoalToEdit({ ...goalToEdit, icon })}
                  >
                    <Ionicons name={icon as any} size={24} color={goalToEdit?.icon === icon ? colors.primary : colors.text} />
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.label, { color: colors.text }]}>Color</Text>
              <View style={styles.colorGrid}>
                {GOAL_COLORS.map((color) => (
                  <TouchableOpacity
                    key={color}
                    style={[
                      styles.colorButton,
                      { backgroundColor: color },
                      goalToEdit?.color === color && styles.colorButtonSelected
                    ]}
                    onPress={() => goalToEdit && setGoalToEdit({ ...goalToEdit, color })}
                  >
                    {goalToEdit?.color === color && (
                      <Ionicons name="checkmark" size={20} color="#fff" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>

              <View style={[styles.infoBox, { backgroundColor: `${colors.primary}20`, borderColor: colors.primary }]}>
                <Ionicons name="information-circle-outline" size={20} color={colors.primary} style={styles.infoIcon} />
                <Text style={[styles.infoText, { color: colors.text }]}>
                  Changing these settings will only apply to future contributions. Past transactions remain unchanged.
                </Text>
              </View>

              <View style={styles.toggleContainer}>
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.toggleLabel, { color: colors.text }]}>Create Transaction</Text>
                    <Text style={[styles.toggleDescription, { color: colors.textMuted }]}>
                      Add to transaction history when contributed
                    </Text>
                  </View>
                  <Switch
                    value={goalToEdit?.affectTransaction ?? true}
                    onValueChange={(value) => {
                      if (goalToEdit) setGoalToEdit({ ...goalToEdit, affectTransaction: value });
                    }}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>

                <View style={styles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.toggleLabel, { color: colors.text }]}>Affect Account Balance</Text>
                    <Text style={[styles.toggleDescription, { color: colors.textMuted }]}>
                      Update account balance when contributed
                    </Text>
                  </View>
                  <Switch
                    value={goalToEdit?.affectAccountBalance ?? true}
                    onValueChange={(value) => {
                      if (goalToEdit) setGoalToEdit({ ...goalToEdit, affectAccountBalance: value });
                    }}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[
                  styles.submitButton, 
                  { backgroundColor: colors.primary },
                  (!goalToEdit?.name || !goalToEdit?.targetAmount || !goalToEdit?.accountId || updateGoalMutation.isPending) && styles.submitButtonDisabled
                ]}
                onPress={() => {
                  if (goalToEdit && goalToEdit.name && goalToEdit.targetAmount && goalToEdit.accountId && !updateGoalMutation.isPending) {
                    // Validate dates
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const startDate = goalToEdit.startDate ? new Date(goalToEdit.startDate) : null;
                    const targetDate = goalToEdit.targetDate ? new Date(goalToEdit.targetDate) : null;

                    if (!startDate || !targetDate) {
                      Toast.show({
                        type: 'error',
                        text1: 'Missing Dates',
                        text2: 'Both start date and target date are required',
                        position: 'bottom',
                      });
                      return;
                    }

                    startDate.setHours(0, 0, 0, 0);
                    targetDate.setHours(0, 0, 0, 0);

                    // Check if target date is in the past
                    if (targetDate < today) {
                      Toast.show({
                        type: 'error',
                        text1: 'Invalid Date',
                        text2: 'Target date cannot be in the past',
                        position: 'bottom',
                      });
                      return;
                    }

                    // Check if start date is before target date
                    if (startDate >= targetDate) {
                      Toast.show({
                        type: 'error',
                        text1: 'Invalid Date',
                        text2: 'Start date must be before target date',
                        position: 'bottom',
                      });
                      return;
                    }

                    // Determine status based on start date - only use valid API status values
                    let status: 'active' | 'completed' | 'cancelled' | 'inactive' = 'active';
                    if (goalToEdit.status === 'completed') {
                      status = 'completed';
                    } else if (goalToEdit.status === 'cancelled') {
                      status = 'cancelled';
                    } else {
                      // Check if start date is in the future
                      if (startDate > today) {
                        status = 'inactive';
                      } else {
                        status = 'active';
                      }
                    }

                    // Calculate monthly expected amount for update
                    const monthlyExpectedAmount = calculateMonthlyExpectedAmount(
                      startDate,
                      targetDate,
                      goalToEdit.targetAmount
                    );

                    updateGoalMutation.mutate({
                      id: goalToEdit.id,
                      data: {
                        name: goalToEdit.name,
                        targetAmount: goalToEdit.targetAmount,
                        startDate: typeof goalToEdit.startDate === 'string' ? goalToEdit.startDate : new Date(goalToEdit.startDate).toISOString(),
                        targetDate: typeof goalToEdit.targetDate === 'string' ? goalToEdit.targetDate : new Date(goalToEdit.targetDate).toISOString(),
                        monthlyExpectedAmount,
                        icon: goalToEdit.icon || undefined,
                        color: goalToEdit.color || undefined,
                        accountId: goalToEdit.accountId,
                        toAccountId: goalToEdit.toAccountId,
                        affectTransaction: goalToEdit.affectTransaction,
                        affectAccountBalance: goalToEdit.affectAccountBalance,
                        status
                      }
                    });
                  }
                }}
                disabled={!goalToEdit?.name || !goalToEdit?.targetAmount || !goalToEdit?.accountId || updateGoalMutation.isPending}
              >
                {updateGoalMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitButtonText}>Update Goal</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Contribute Modal */}
      <Modal
        visible={isContributeModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setIsContributeModalOpen(false);
          setContributeCreateTransaction(true);
          setContributeAffectBalance(true);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Add to {selectedGoal?.name}
              </Text>
              <TouchableOpacity onPress={() => {
                setIsContributeModalOpen(false);
                setContributeCreateTransaction(true);
                setContributeAffectBalance(true);
              }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalBody}>
              <Text style={[styles.label, { color: colors.text }]}>Amount (₹)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                placeholder="1000"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                value={contributionAmount}
                onChangeText={setContributionAmount}
              />

              <Text style={[styles.label, { color: colors.text }]}>Contribution Date</Text>
              <TouchableOpacity
                style={[styles.dateButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => setShowContributionDatePicker(true)}
              >
                <Text style={[styles.dateButtonText, { color: colors.text }]}>
                  {contributionDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
                <Ionicons name="calendar-outline" size={20} color={colors.text} />
              </TouchableOpacity>

              {showContributionDatePicker && (
                <DateTimePicker
                  value={contributionDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, selectedDate) => {
                    setShowContributionDatePicker(Platform.OS === 'ios');
                    if (selectedDate) {
                      setContributionDate(selectedDate);
                    }
                  }}
                  maximumDate={new Date()}
                  themeVariant={resolvedTheme}
                />
              )}

              <View style={styles.toggleRow}>
                <View style={styles.toggleInfo}>
                  <Text style={[styles.toggleLabel, { color: colors.text }]}>Create Transaction</Text>
                  <Text style={[styles.toggleHint, { color: colors.textMuted }]}>
                    Record this contribution as a transaction
                  </Text>
                </View>
                <Switch
                  value={contributeCreateTransaction}
                  onValueChange={setContributeCreateTransaction}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={styles.toggleInfo}>
                  <Text style={[styles.toggleLabel, { color: colors.text }]}>Affect Account Balance</Text>
                  <Text style={[styles.toggleHint, { color: colors.textMuted }]}>
                    Deduct from source account balance
                  </Text>
                </View>
                <Switch
                  value={contributeAffectBalance}
                  onValueChange={setContributeAffectBalance}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  disabled={!selectedGoal?.accountId}
                />
              </View>

              <Text style={[styles.toggleNote, { color: colors.textMuted }]}>
                These settings apply to this contribution only
              </Text>

              <TouchableOpacity
                style={[
                  styles.submitButton, 
                  { backgroundColor: colors.primary },
                  (!contributionAmount || addContributionMutation.isPending) && styles.submitButtonDisabled
                ]}
                onPress={() => {
                  if (selectedGoal && contributionAmount && !addContributionMutation.isPending) {
                    addContributionMutation.mutate({ 
                      goalId: selectedGoal.id, 
                      amount: contributionAmount,
                      contributedAt: contributionDate.toISOString(),
                      createTransaction: contributeCreateTransaction,
                      affectBalance: contributeAffectBalance,
                    });
                  }
                }}
                disabled={!contributionAmount || addContributionMutation.isPending}
              >
                {addContributionMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitButtonText}>Add Contribution</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Contributions List Modal */}
      <Modal
        visible={isContributionsModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setIsContributionsModalOpen(false);
          setSelectedGoal(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Contributions for {selectedGoal?.name}
              </Text>
              <TouchableOpacity onPress={() => {
                setIsContributionsModalOpen(false);
                setSelectedGoal(null);
              }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalBody}>
              {contributions && contributions.length > 0 ? (
                contributions.map((contribution: any) => (
                  <View 
                    key={contribution.id} 
                    style={[styles.contributionItem, { backgroundColor: colors.card }]}
                  >
                    <View style={styles.contributionInfo}>
                      <Text style={[styles.contributionAmount, { color: colors.primary }]}>
                        {formatCurrency(parseFloat(contribution.amount))}
                      </Text>
                      <Text style={[styles.contributionDate, { color: colors.textMuted }]}>
                        {new Date(contribution.contributedAt).toLocaleDateString('en-US', { 
                          day: 'numeric', 
                          month: 'short', 
                          year: 'numeric' 
                        })}
                        {contribution.account && ` • ${contribution.account.name}`}
                      </Text>
                      {contribution.notes && (
                        <Text style={[styles.contributionNotes, { color: colors.textMuted }]}>
                          {contribution.notes}
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity 
                      onPress={() => deleteContributionMutation.mutate(contribution.id)}
                      style={[styles.deleteContributionButton, { backgroundColor: '#fee2e2' }]}
                      disabled={deleteContributionMutation.isPending}
                    >
                      {deleteContributionMutation.isPending ? (
                        <ActivityIndicator size="small" color="#ef4444" />
                      ) : (
                        <Ionicons name="trash-outline" size={20} color="#ef4444" />
                      )}
                    </TouchableOpacity>
                  </View>
                ))
              ) : (
                <View style={styles.emptyContributions}>
                  <Ionicons name="wallet-outline" size={48} color={colors.textMuted} />
                  <Text style={[styles.emptyText, { color: colors.text }]}>
                    No contributions yet
                  </Text>
                  <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
                    Add your first contribution to this goal
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        transparent={true}
        animationType="fade"
        onRequestClose={cancelDelete}
      >
        <View style={styles.deleteModalOverlay}>
          <View style={[styles.deleteModalContent, { backgroundColor: colors.card }]}>
            <View style={styles.deleteModalHeader}>
              <Ionicons name="warning-outline" size={48} color="#ef4444" />
            </View>
            <Text style={[styles.deleteModalTitle, { color: colors.text }]}>Delete Savings Goal?</Text>
            <Text style={[styles.deleteModalMessage, { color: colors.textMuted }]}>
              Are you sure you want to delete "{goalToDelete?.name}"? This will permanently delete all contributions. This action cannot be undone.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton, { borderColor: colors.border }]}
                onPress={cancelDelete}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.deleteButton]}
                onPress={confirmDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.deleteButtonText}>Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  tabContent: {
    padding: 16,
  },
  totalCard: {
    backgroundColor: '#10b981',
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
  },
  totalLabel: {
    fontSize: 13,
    color: '#fff',
    opacity: 0.9,
  },
  totalValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    marginTop: 4,
  },
  totalSubtitle: {
    fontSize: 12,
    color: '#fff',
    opacity: 0.8,
    marginTop: 4,
  },
  totalProgressBar: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 4,
    marginTop: 12,
    overflow: 'hidden',
  },
  totalProgressFill: {
    height: '100%',
    backgroundColor: '#fff',
    borderRadius: 4,
  },
  goalCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  goalHeader: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  goalIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  goalInfo: {
    flex: 1,
  },
  goalNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  goalName: {
    fontSize: 16,
    fontWeight: '600',
  },
  overdueBadge: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  overdueText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  goalDetails: {
    fontSize: 12,
    marginTop: 4,
  },
  progressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  progressBar: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressPercent: {
    fontSize: 12,
    fontWeight: '600',
    width: 40,
    textAlign: 'right',
  },
  dateRangeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  dateItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dateLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  dateValue: {
    fontSize: 11,
    fontWeight: '600',
  },
  goalActions: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
  contributeButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  contributeButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  viewButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  viewButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 24,
    marginBottom: 12,
  },
  completedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    gap: 12,
  },
  completedInfo: {
    flex: 1,
  },
  completedName: {
    fontSize: 15,
    fontWeight: '500',
  },
  completedAmount: {
    fontSize: 12,
    marginTop: 2,
  },
  manageCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  manageCardInactive: {
    opacity: 0.6,
  },
  manageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  smallIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  manageInfo: {
    flex: 1,
  },
  manageName: {
    fontSize: 15,
    fontWeight: '500',
  },
  manageAmount: {
    fontSize: 12,
    marginTop: 2,
  },
  smallProgressBar: {
    height: 4,
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden',
  },
  smallProgressFill: {
    height: '100%',
    borderRadius: 2,
  },
  manageActions: {
    alignItems: 'flex-end',
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11,
    textTransform: 'capitalize',
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  emptyCard: {
    padding: 40,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
    marginTop: 16,
  },
  addFirstButton: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
  },
  addFirstButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  modalBody: {
    padding: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    gap: 8,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  iconButton: {
    width: 50,
    height: 50,
    borderRadius: 8,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  colorButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  colorButtonSelected: {
    borderColor: '#fff',
  },
  accountSelector: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginBottom: 16,
  },
  dropdownButton: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  dropdownText: {
    fontSize: 15,
  },
  dropdownList: {
    marginTop: -8,
    marginBottom: 16,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  dropdownItemText: {
    fontSize: 14,
    fontWeight: '500',
  },
  dropdownItemSubtext: {
    fontSize: 12,
    marginTop: 2,
  },
  accountIconSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountOption: {
    width: 120,
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    marginRight: 8,
    alignItems: 'center',
  },
  accountIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  accountName: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
    textAlign: 'center',
  },
  accountBalance: {
    fontSize: 11,
  },
  submitButton: {
    marginTop: 24,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
    marginBottom: 4,
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
    marginBottom: 12,
  },
  accountScroll: {
    marginBottom: 16,
  },
  accountChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 2,
    marginRight: 8,
    minWidth: 120,
  },
  accountChipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  dateButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  dateButtonText: {
    fontSize: 16,
  },
  contributionItem: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    alignItems: 'center',
  },
  contributionInfo: {
    flex: 1,
  },
  contributionAmount: {
    fontSize: 16,
    fontWeight: '600',
  },
  contributionDate: {
    fontSize: 12,
    marginTop: 2,
  },
  contributionNotes: {
    fontSize: 12,
    marginTop: 4,
  },
  deleteContributionButton: {
    padding: 8,
    borderRadius: 8,
  },
  emptyContributions: {
    alignItems: 'center',
    padding: 40,
  },
  emptySubtext: {
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  swipeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    height: '100%',
  },
  swipeActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  webActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    marginLeft: 12,
  },
  webActionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  deleteModalContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  deleteModalHeader: {
    marginBottom: 16,
  },
  deleteModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  deleteModalMessage: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelButton: {
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#ef4444',
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  toggleContainer: {
    marginTop: 16,
    marginBottom: 8,
    gap: 12,
  },
  toggleDescription: {
    fontSize: 14,
    lineHeight: 18,
  },
  infoIcon: {
    marginRight: 8,
    marginTop: 2,
  },
  impactContainer: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4, // Space below the due date line
    flexWrap: 'wrap',
  },
  impactBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  impactText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  checklistInfoRow: {
    // Container for your text block
  },
});
