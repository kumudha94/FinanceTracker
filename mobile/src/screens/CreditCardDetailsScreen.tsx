import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Dimensions, Switch } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { LineChart } from 'react-native-chart-kit';
import { api } from '../lib/api';
import { formatCurrency, getThemedColors, getOrdinalSuffix } from '../lib/utils';
import type { Loan } from '../lib/types';
import { useState, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const screenWidth = Dimensions.get('window').width;

export default function CreditCardDetailsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [showPayments, setShowPayments] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null); // null = "All"

  const { data: accounts } = useQuery({
    queryKey: ['/api/accounts'],
    queryFn: api.getAccounts,
  });

  const { data: transactions, isLoading, error } = useQuery({
    queryKey: ['/api/transactions'],
    queryFn: api.getTransactions,
  });

  const { data: loans } = useQuery({
    queryKey: ['/api/loans'],
    queryFn: api.getLoans,
  });

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const creditCards = useMemo(() => {
    return accounts?.filter(acc => acc.type === 'credit_card' && acc.isActive) || [];
  }, [accounts]);

  const filteredData = useMemo(() => {
    if (!transactions || !creditCards.length) return null;

    const startOfMonth = new Date(selectedYear, selectedMonth, 1);
    const endOfMonth = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59);

    const cardBreakdown = creditCards.map(card => {
      const cardTransactions = transactions.filter(t => {
        const transactionDate = new Date(t.transactionDate);
        return t.accountId === card.id &&
               t.type === 'debit' &&
               transactionDate >= startOfMonth &&
               transactionDate <= endOfMonth;
      });

      const totalSpent = cardTransactions.reduce((sum, t) => sum + parseFloat(t.amount), 0);

      return {
        accountId: card.id,
        accountName: card.name,
        color: card.color || colors.primary,
        billingDate: card.billingDate || 1,
        creditLimit: card.creditLimit ? parseFloat(card.creditLimit) : 0,
        totalSpent,
        transactionCount: cardTransactions.length,
        transactions: cardTransactions.sort((a, b) => 
          new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime()
        ),
      };
    }).filter(card => card.transactionCount > 0);

    const totalSpending = cardBreakdown.reduce((sum, card) => sum + card.totalSpent, 0);

    return {
      totalSpending,
      breakdown: cardBreakdown,
    };
  }, [transactions, creditCards, selectedMonth, selectedYear, colors]);

  // Category breakdown for "All" view
  const categoryBreakdown = useMemo(() => {
    if (!transactions || !creditCards.length) return [];

    const startOfMonth = new Date(selectedYear, selectedMonth, 1);
    const endOfMonth = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59);

    const creditCardIds = creditCards.map(c => c.id);
    const categoryMap = new Map<string, { total: number; count: number; color: string; categoryId: number }>();

    transactions.forEach(t => {
      const transactionDate = new Date(t.transactionDate);
      if (
        t.accountId && creditCardIds.includes(t.accountId) &&
        t.type === 'debit' &&
        transactionDate >= startOfMonth &&
        transactionDate <= endOfMonth &&
        t.category
      ) {
        const key = t.category.name;
        const existing = categoryMap.get(key) || { total: 0, count: 0, color: t.category.color || colors.primary, categoryId: t.category.id };
        categoryMap.set(key, {
          ...existing,
          total: existing.total + parseFloat(t.amount),
          count: existing.count + 1,
        });
      }
    });

    return Array.from(categoryMap.entries())
      .map(([name, data]) => ({
        categoryName: name,
        categoryId: data.categoryId,
        total: data.total,
        transactionCount: data.count,
        color: data.color,
      }))
      .sort((a, b) => b.total - a.total);
  }, [transactions, creditCards, selectedMonth, selectedYear, colors]);

  const ccLoanEMIs = useMemo(() => {
    if (!loans || !creditCards.length) return { totalEMI: 0, byCard: new Map() };

    const activeCCLoans = loans.filter(loan => 
      loan.type === 'credit_card_loan' && 
      loan.accountId && 
      loan.status === 'active' &&
      creditCards.some(card => card.id === loan.accountId)
    );

    const byCard = new Map<number, { loans: Loan[]; totalEMI: number }>();
    let totalEMI = 0;

    activeCCLoans.forEach(loan => {
      const emiAmount = parseFloat(loan.emiAmount || '0');
      totalEMI += emiAmount;
      
      const cardId = loan.accountId!;
      const existing = byCard.get(cardId) || { loans: [], totalEMI: 0 };
      existing.loans.push(loan);
      existing.totalEMI += emiAmount;
      byCard.set(cardId, existing);
    });

    return { totalEMI, byCard };
  }, [loans, creditCards]);

  const cardsWithActivity = useMemo(() => {
    const cardMap = new Map<number, { 
      accountId: number; 
      accountName: string; 
      color: string;
      hasSpending: boolean;
      hasLoans: boolean;
      totalSpent: number;
      totalEMI: number;
    }>();

    filteredData?.breakdown.forEach(card => {
      cardMap.set(card.accountId, {
        accountId: card.accountId,
        accountName: card.accountName,
        color: card.color,
        hasSpending: true,
        hasLoans: ccLoanEMIs.byCard.has(card.accountId),
        totalSpent: card.totalSpent,
        totalEMI: ccLoanEMIs.byCard.get(card.accountId)?.totalEMI || 0,
      });
    });

    ccLoanEMIs.byCard.forEach((data, cardId) => {
      if (!cardMap.has(cardId)) {
        const card = creditCards.find(c => c.id === cardId);
        if (card) {
          cardMap.set(cardId, {
            accountId: card.id,
            accountName: card.name,
            color: card.color || colors.primary,
            hasSpending: false,
            hasLoans: true,
            totalSpent: 0,
            totalEMI: data.totalEMI,
          });
        }
      }
    });

    return Array.from(cardMap.values());
  }, [filteredData, ccLoanEMIs, creditCards, colors]);

  const handlePreviousMonth = () => {
    if (selectedMonth === 0) {
      setSelectedMonth(11);
      setSelectedYear(selectedYear - 1);
    } else {
      setSelectedMonth(selectedMonth - 1);
    }
  };

  const handleNextMonth = () => {
    const currentDate = new Date();
    const isCurrentMonth = selectedMonth === currentDate.getMonth() && selectedYear === currentDate.getFullYear();
    
    if (isCurrentMonth) {
      return; // Don't allow going to future months
    }
    
    if (selectedMonth === 11) {
      setSelectedMonth(0);
      setSelectedYear(selectedYear + 1);
    } else {
      setSelectedMonth(selectedMonth + 1);
    }
  };

  const isCurrentMonth = selectedMonth === now.getMonth() && selectedYear === now.getFullYear();

  // Get card icon based on bank/card name
  const getCardIcon = (cardName: string): string => {
    const iconMap: { [key: string]: string } = {
      'HDFC': 'card',
      'ICICI': 'card',
      'SBI': 'card',
      'Axis': 'card',
      'Kotak': 'card',
      'Amex': 'card',
      'Citi': 'card',
    };
    const match = Object.keys(iconMap).find(key => cardName.toUpperCase().includes(key));
    return match ? iconMap[match] : 'card-outline';
  };

  // Category icon mapping
  const getCategoryIcon = (categoryName: string): string => {
    const iconMap: { [key: string]: string } = {
      'Groceries': 'cart',
      'Transport': 'car',
      'Dining': 'restaurant',
      'Shopping': 'bag-handle',
      'Entertainment': 'game-controller',
      'Bills': 'receipt',
      'Health': 'medical',
      'Education': 'school',
      'Travel': 'airplane',
      'Salary': 'briefcase',
      'Investment': 'trending-up',
      'Transfer': 'repeat',
      'Other': 'ellipsis-horizontal',
      'Food': 'fast-food',
      'Rent': 'home',
      'Utilities': 'flash',
      'Personal': 'person',
      'Insurance': 'shield-checkmark',
      'EMI': 'card',
    };
    return iconMap[categoryName] || 'pricetag';
  };

  // Map invalid icon names to valid Ionicons
  const getValidIconName = (iconName: string): string => {
    const iconMap: { [key: string]: string } = {
      'shopping-bag': 'bag-handle',
      'shopping-cart': 'cart-outline',
    };
    return iconMap[iconName] || iconName || 'ellipsis-horizontal';
  };

  const selectedCard = selectedCardId 
    ? cardsWithActivity.find(c => c.accountId === selectedCardId)
    : null;
  
  const selectedCardSpendingData = selectedCardId 
    ? filteredData?.breakdown.find(c => c.accountId === selectedCardId)
    : null;

  const pieChartData = useMemo(() => {
    if (!filteredData?.breakdown || filteredData.breakdown.length === 0) return [];
    
    return filteredData.breakdown.map((card, index) => ({
      name: card.accountName.length > 12 ? card.accountName.substring(0, 12) + '...' : card.accountName,
      amount: card.totalSpent,
      color: card.color,
      legendFontColor: colors.text,
      legendFontSize: 13,
    }));
  }, [filteredData, colors]);


  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header with gradient */}
      <LinearGradient
        colors={[colors.gradientStart, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.header}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Credit Cards</Text>
        <TouchableOpacity style={styles.menuButton}>
          <Ionicons name="ellipsis-vertical" size={24} color="#fff" />
        </TouchableOpacity>
      </LinearGradient>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* FIRST HALF - Month selector and card list */}
        <View style={styles.firstHalf}>
          {/* Month Navigation with Total */}
          <View style={[styles.monthCard, { backgroundColor: colors.card, borderColor: colors.primary }]}>
            <View style={styles.monthRow}>
              <TouchableOpacity onPress={handlePreviousMonth} style={styles.navButton}>
                <Ionicons name="chevron-back-outline" size={28} color={colors.primary} />
              </TouchableOpacity>
              
              <View style={styles.monthInfo}>
                <Text style={[styles.monthText, { color: colors.text }]}>
                  {monthNames[selectedMonth].toUpperCase()} '{String(selectedYear).slice(-2)}
                </Text>
                <View style={styles.totalsRow}>
                  <Text style={[styles.totalAmount, { color: '#ff9800' }]}>
                    ₹{(filteredData?.totalSpending || 0).toFixed(0)}
                  </Text>
                  {showPayments && (
                    <Text style={[styles.totalAmount, { color: colors.success, marginLeft: 16 }]}>
                      (₹0)
                    </Text>
                  )}
                </View>
              </View>
              
              <TouchableOpacity 
                onPress={handleNextMonth} 
                style={styles.navButton}
                disabled={isCurrentMonth}
              >
                <Ionicons 
                  name="chevron-forward-outline" 
                  size={28} 
                  color={isCurrentMonth ? colors.textMuted : colors.primary} 
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Card Filter Chips */}
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            style={styles.chipContainer}
            contentContainerStyle={styles.chipContent}
          >
            <TouchableOpacity
              style={[
                styles.chip,
                { backgroundColor: selectedCardId === null ? colors.primary : colors.card },
                selectedCardId === null && styles.chipSelected
              ]}
              onPress={() => setSelectedCardId(null)}
            >
              <Text style={[
                styles.chipText,
                { color: selectedCardId === null ? '#fff' : colors.text }
              ]}>
                All
              </Text>
            </TouchableOpacity>
            
            {cardsWithActivity.map((card) => (
              <TouchableOpacity
                key={card.accountId}
                style={[
                  styles.chip,
                  { backgroundColor: selectedCardId === card.accountId ? colors.primary : colors.card },
                  selectedCardId === card.accountId && styles.chipSelected
                ]}
                onPress={() => setSelectedCardId(card.accountId)}
              >
                <View style={[styles.chipDot, { backgroundColor: card.color }]} />
                <Text style={[
                  styles.chipText,
                  { color: selectedCardId === card.accountId ? '#fff' : colors.text }
                ]}>
                  {card.accountName}
                </Text>
                {card.hasLoans && !card.hasSpending && (
                  <Ionicons name="card" size={12} color={selectedCardId === card.accountId ? '#fff' : colors.primary} style={{ marginLeft: 4 }} />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Content based on selection */}
          <View style={styles.cardSection}>
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.loadingText, { color: colors.textMuted }]}>Loading cards...</Text>
              </View>
            ) : error ? (
              <View style={styles.emptyState}>
                <Ionicons name="alert-circle-outline" size={56} color={colors.textMuted} />
                <Text style={[styles.emptyText, { color: colors.textMuted }]}>Failed to load credit card details</Text>
              </View>
            ) : selectedCardId === null ? (
              // Show category breakdown for all cards
              categoryBreakdown.length > 0 ? (
                categoryBreakdown.map((category) => (
                  <TouchableOpacity 
                    key={category.categoryId} 
                    style={[styles.categoryCard, { backgroundColor: colors.card }]}
                    activeOpacity={0.7}
                  >
                    <View style={styles.categoryRow}>
                      <View style={styles.categoryLeft}>
                        <LinearGradient
                          colors={[category.color + 'CC', category.color]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.iconContainer}
                        >
                          <Ionicons name={getCategoryIcon(category.categoryName) as any} size={24} color="#fff" />
                        </LinearGradient>
                        <View>
                          <Text style={[styles.cardName, { color: colors.text }]}>
                            {category.categoryName}
                          </Text>
                          <Text style={[styles.billingInfo, { color: colors.textMuted }]}>
                            {category.transactionCount} transaction{category.transactionCount !== 1 ? 's' : ''}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.cardAmount, { color: colors.text }]}>
                        ₹{category.total.toFixed(0)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="pie-chart-outline" size={56} color={colors.textMuted} />
                  <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                    No credit card spending this month
                  </Text>
                </View>
              )
            ) : selectedCard ? (
              // Show selected card details
              <View>
                <TouchableOpacity 
                  style={[styles.cardItem, { backgroundColor: colors.card }]}
                  activeOpacity={1}
                >
                  <View style={styles.cardRow}>
                    <View style={styles.cardLeft}>
                      <LinearGradient
                        colors={[selectedCard.color + 'CC', selectedCard.color]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.iconContainer}
                      >
                        <Ionicons name={getCardIcon(selectedCard.accountName) as any} size={24} color="#fff" />
                      </LinearGradient>
                      <View style={styles.cardDetails}>
                        <Text style={[styles.cardName, { color: colors.text }]}>
                          {selectedCard.accountName}
                        </Text>
                        <Text style={[styles.billingInfo, { color: colors.textMuted }]}>
                          {selectedCardSpendingData 
                            ? `Bill: ${selectedCardSpendingData.billingDate}${getOrdinalSuffix(selectedCardSpendingData.billingDate)} • ${selectedCardSpendingData.transactionCount} txns`
                            : selectedCard.hasLoans ? 'EMI loans only' : 'No activity'
                          }
                        </Text>
                        {selectedCardSpendingData && selectedCardSpendingData.creditLimit > 0 && (
                          <View style={styles.utilizationRow}>
                            <View style={[styles.utilizationBar, { backgroundColor: colors.border }]}>
                              <View 
                                style={[
                                  styles.utilizationFill,
                                  { 
                                    width: `${Math.min((selectedCard.totalSpent / selectedCardSpendingData.creditLimit) * 100, 100)}%`,
                                    backgroundColor: (selectedCard.totalSpent / selectedCardSpendingData.creditLimit) * 100 >= 90 ? '#f44336' : 
                                                     (selectedCard.totalSpent / selectedCardSpendingData.creditLimit) * 100 >= 70 ? '#ff9800' : colors.success
                                  }
                                ]} 
                              />
                            </View>
                            <Text style={[styles.utilizationText, { color: colors.textMuted }]}>
                              {((selectedCard.totalSpent / selectedCardSpendingData.creditLimit) * 100).toFixed(0)}%
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                    <View style={styles.cardRight}>
                      <Text style={[styles.cardAmount, { color: colors.text }]}>
                        ₹{selectedCard.totalSpent.toFixed(0)}
                      </Text>
                      {selectedCard.totalEMI > 0 && (
                        <Text style={[styles.limitText, { color: '#ff9800' }]}>
                          +₹{selectedCard.totalEMI.toFixed(0)} EMI
                        </Text>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>

                {/* Category breakdown for selected card - only if has spending */}
                {selectedCardSpendingData && selectedCardSpendingData.transactions && (
                  <>
                    <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Category Breakdown</Text>
                    {(() => {
                      const cardCategories = new Map<string, { total: number; count: number; color: string; categoryId: number }>();
                      selectedCardSpendingData.transactions.forEach((t: any) => {
                        if (t.category) {
                          const key = t.category.name;
                          const existing = cardCategories.get(key) || { total: 0, count: 0, color: t.category.color || colors.primary, categoryId: t.category.id };
                          cardCategories.set(key, {
                            ...existing,
                            total: existing.total + parseFloat(t.amount),
                            count: existing.count + 1,
                          });
                        }
                      });

                      return Array.from(cardCategories.entries())
                        .map(([name, data]) => ({ categoryName: name, ...data }))
                        .sort((a, b) => b.total - a.total)
                        .map((category) => (
                          <View 
                            key={category.categoryId} 
                            style={[styles.smallCategoryCard, { backgroundColor: colors.card }]}
                          >
                            <View style={styles.smallCategoryRow}>
                              <View style={styles.smallCategoryLeft}>
                                <View style={[styles.smallColorDot, { backgroundColor: category.color }]} />
                                <Text style={[styles.smallCategoryName, { color: colors.text }]}>
                                  {category.categoryName}
                                </Text>
                              </View>
                              <Text style={[styles.smallCategoryAmount, { color: colors.textMuted }]}>
                                ₹{category.total.toFixed(0)}
                              </Text>
                            </View>
                          </View>
                        ));
                    })()}
                  </>
                )}

                {/* No spending message for cards with only loans */}
                {!selectedCardSpendingData && selectedCard.hasLoans && (
                  <View style={styles.emptyState}>
                    <Ionicons name="wallet-outline" size={40} color={colors.textMuted} />
                    <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                      No spending this month - only EMI loans
                    </Text>
                  </View>
                )}
              </View>
            ) : null}
          </View>

          {/* CC Loan EMI Contributions Section */}
          {ccLoanEMIs.totalEMI > 0 && (
            <View style={styles.emiSection}>
              <View style={styles.emiHeader}>
                <View style={styles.emiHeaderLeft}>
                  <Ionicons name="card" size={20} color={colors.primary} />
                  <Text style={[styles.emiHeaderTitle, { color: colors.text }]}>
                    Pending EMI Contributions
                  </Text>
                </View>
                <Text style={[styles.emiHeaderTotal, { color: '#ff9800' }]}>
                  ₹{ccLoanEMIs.totalEMI.toFixed(0)}
                </Text>
              </View>
              
              <Text style={[styles.emiHelperText, { color: colors.textMuted }]}>
                These EMI amounts are added to your credit card bills each month
              </Text>

              {selectedCardId === null ? (
                Array.from(ccLoanEMIs.byCard.entries()).map(([cardId, data]) => {
                  const card = creditCards.find(c => c.id === cardId);
                  if (!card) return null;
                  return (
                    <View key={cardId} style={[styles.emiCard, { backgroundColor: colors.card }]}>
                      <View style={styles.emiCardHeader}>
                        <View style={[styles.emiCardDot, { backgroundColor: card.color || colors.primary }]} />
                        <Text style={[styles.emiCardName, { color: colors.text }]}>{card.name}</Text>
                        <Text style={[styles.emiCardTotal, { color: '#ff9800' }]}>₹{data.totalEMI.toFixed(0)}</Text>
                      </View>
                      {data.loans.map((loan: Loan) => (
                        <View key={loan.id} style={styles.emiLoanRow}>
                          <Text style={[styles.emiLoanName, { color: colors.textMuted }]}>{loan.name}</Text>
                          <Text style={[styles.emiLoanAmount, { color: colors.text }]}>₹{parseFloat(loan.emiAmount || '0').toFixed(0)}</Text>
                        </View>
                      ))}
                    </View>
                  );
                })
              ) : (
                ccLoanEMIs.byCard.get(selectedCardId)?.loans.map((loan: Loan) => (
                  <View key={loan.id} style={[styles.emiCard, { backgroundColor: colors.card }]}>
                    <View style={styles.emiLoanRowSingle}>
                      <View>
                        <Text style={[styles.emiLoanNameLarge, { color: colors.text }]}>{loan.name}</Text>
                        <Text style={[styles.emiLoanMeta, { color: colors.textMuted }]}>
                          {loan.tenure || 0} EMIs remaining • ₹{parseFloat(loan.outstandingAmount || '0').toFixed(0)} outstanding
                        </Text>
                      </View>
                      <View style={styles.emiLoanAmountBox}>
                        <Text style={[styles.emiLoanAmountLarge, { color: '#ff9800' }]}>₹{parseFloat(loan.emiAmount || '0').toFixed(0)}</Text>
                        <Text style={[styles.emiLoanAmountLabel, { color: colors.textMuted }]}>monthly</Text>
                      </View>
                    </View>
                  </View>
                )) || (
                  <Text style={[styles.noEmiText, { color: colors.textMuted }]}>
                    No EMI loans on this card
                  </Text>
                )
              )}
            </View>
          )}
        </View>

        {/* SECOND HALF - Toggle and Chart */}
        <LinearGradient
          colors={[colors.gradientStart, colors.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.secondHalf}
        >
          {/* Toggle for showing payments */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleButton}>
              <Ionicons name="wallet" size={20} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.toggleLabel}>Show Payments</Text>
            </View>
            <Switch
              value={showPayments}
              onValueChange={setShowPayments}
              trackColor={{ false: 'rgba(255,255,255,0.3)', true: 'rgba(255,255,255,0.5)' }}
              thumbColor={showPayments ? '#fff' : '#f4f3f4'}
              ios_backgroundColor="rgba(255,255,255,0.3)"
            />
          </View>

          {/* Chart Section */}
          <Text style={styles.chartTitle}>MONTHLY SPENDING ( Rs )</Text>
          
          {!isLoading && filteredData?.breakdown && filteredData.breakdown.length > 0 ? (
            <LineChart
              data={{
                labels: filteredData.breakdown.slice(0, 6).map((card, idx) => {
                  return card.accountName.substring(0, 4).toUpperCase();
                }),
                datasets: [{
                  data: filteredData.breakdown.slice(0, 6).map(card => card.totalSpent),
                  color: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
                  strokeWidth: 3
                }]
              }}
              width={screenWidth}
              height={260}
              chartConfig={{
                backgroundColor: 'transparent',
                backgroundGradientFrom: 'transparent',
                backgroundGradientTo: 'transparent',
                decimalPlaces: 0,
                color: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
                labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity * 0.8})`,
                style: {
                  borderRadius: 0,
                },
                propsForDots: {
                  r: '6',
                  strokeWidth: '3',
                  stroke: '#fff',
                  fill: colors.primary
                },
                propsForBackgroundLines: {
                  strokeDasharray: '',
                  stroke: 'rgba(255,255,255,0.15)',
                  strokeWidth: 1,
                },
              }}
              bezier
              style={{
                marginVertical: 0,
                marginLeft: -16,
              }}
              withInnerLines={true}
              withOuterLines={false}
              withVerticalLines={false}
              withHorizontalLines={true}
              withVerticalLabels={true}
              withHorizontalLabels={true}
              fromZero
            />
          ) : (
            <View style={styles.emptyChart}>
              <Ionicons name="bar-chart-outline" size={48} color="rgba(255,255,255,0.5)" />
              <Text style={styles.emptyChartText}>No data available</Text>
            </View>
          )}
        </LinearGradient>
        
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Bottom Tab Bar
          This screen is pushed on the root navigator (not nested inside the More tab's
          stack) so back/tab-switch behavior stays correct — see Section 6.1 in TODO.md
          for the bug that pattern avoids. This bar is a visual-only replica of TabNavigator
          in App.tsx; tapping an item jumps back into the real tab navigator (popping this
          screen) rather than rendering an actual nested tab. Keep the icons/labels/routes
          in sync with TabNavigator if that changes. */}
      <View
        style={[
          styles.tabBar,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 5),
          },
        ]}
      >
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => (navigation.navigate as any)('Main', { screen: 'Dashboard' })}
          data-testid="button-tab-dashboard"
        >
          <Ionicons name="home-outline" size={24} color={colors.textMuted} />
          <Text style={[styles.tabLabel, { color: colors.textMuted }]}>My Tracker</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => (navigation.navigate as any)('Main', { screen: 'Accounts' })}
          data-testid="button-tab-accounts"
        >
          <Ionicons name="wallet-outline" size={24} color={colors.textMuted} />
          <Text style={[styles.tabLabel, { color: colors.textMuted }]}>Accounts</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => (navigation.navigate as any)('Main', { screen: 'Transactions' })}
          data-testid="button-tab-transactions"
        >
          <Ionicons name="list-outline" size={24} color={colors.textMuted} />
          <Text style={[styles.tabLabel, { color: colors.textMuted }]}>Transactions</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => (navigation.navigate as any)('Main', { screen: 'More' })}
          data-testid="button-tab-more"
        >
          <Ionicons name="menu-outline" size={24} color={colors.textMuted} />
          <Text style={[styles.tabLabel, { color: colors.textMuted }]}>More</Text>
        </TouchableOpacity>
      </View>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 48,
  },
  backButton: {
    padding: 4,
  },
  menuButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 5,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  tabLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  scrollView: {
    flex: 1,
  },
  firstHalf: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 16,
  },
  monthCard: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    borderWidth: 2,
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navButton: {
    padding: 4,
  },
  monthInfo: {
    alignItems: 'center',
    flex: 1,
  },
  monthText: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
    letterSpacing: 1.5,
    opacity: 0.7,
  },
  totalsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  totalAmount: {
    fontSize: 22,
    fontWeight: '700',
  },
  chipContainer: {
    marginBottom: 20,
  },
  chipContent: {
    paddingRight: 16,
    gap: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  chipSelected: {
    shadowColor: '#16a34a',
    shadowOpacity: 0.2,
    elevation: 4,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  cardSection: {
    marginBottom: 8,
  },
  categoryCard: {
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  categoryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  cardItem: {
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 12,
    marginLeft: 4,
  },
  smallCategoryCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  smallCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  smallCategoryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  smallColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  smallCategoryName: {
    fontSize: 13,
    fontWeight: '500',
  },
  smallCategoryAmount: {
    fontSize: 13,
    fontWeight: '600',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    flex: 1,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  cardDetails: {
    flex: 1,
  },
  cardName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 3,
  },
  billingInfo: {
    fontSize: 12,
    opacity: 0.6,
    marginBottom: 6,
  },
  utilizationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  utilizationBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  utilizationFill: {
    height: '100%',
    borderRadius: 3,
  },
  utilizationText: {
    fontSize: 11,
    fontWeight: '600',
    minWidth: 32,
  },
  cardRight: {
    alignItems: 'flex-end',
  },
  cardAmount: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  limitText: {
    fontSize: 11,
    marginTop: 2,
    opacity: 0.6,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    fontSize: 14,
    marginTop: 12,
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 16,
    fontWeight: '500',
  },
  secondHalf: {
    paddingTop: 24,
    paddingBottom: 40,
    paddingHorizontal: 16,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    marginTop: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
    paddingHorizontal: 4,
  },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  chartTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 2,
    marginBottom: 16,
    marginLeft: 4,
  },
  emptyChart: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyChartText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    marginTop: 12,
    fontWeight: '500',
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  emiSection: {
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  emiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  emiHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  emiHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  emiHeaderTotal: {
    fontSize: 18,
    fontWeight: '700',
  },
  emiHelperText: {
    fontSize: 12,
    marginBottom: 16,
  },
  emiCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  emiCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  emiCardDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  emiCardName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  emiCardTotal: {
    fontSize: 15,
    fontWeight: '700',
  },
  emiLoanRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    paddingLeft: 20,
  },
  emiLoanName: {
    fontSize: 13,
  },
  emiLoanAmount: {
    fontSize: 13,
    fontWeight: '600',
  },
  emiLoanRowSingle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  emiLoanNameLarge: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  emiLoanMeta: {
    fontSize: 12,
  },
  emiLoanAmountBox: {
    alignItems: 'flex-end',
  },
  emiLoanAmountLarge: {
    fontSize: 18,
    fontWeight: '700',
  },
  emiLoanAmountLabel: {
    fontSize: 11,
  },
  noEmiText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 16,
  },
});
