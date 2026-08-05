import { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { format } from 'date-fns';
import { getThemedColors, formatCurrency } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import { api } from '../lib/api';
import type { SmsPaymentMatchCandidate } from '../lib/types';

const ITEM_TYPE_LABEL: Record<SmsPaymentMatchCandidate['itemType'], string> = {
  loan: 'Loan EMI',
  insurance: 'Insurance Premium',
  scheduled_payment: 'Scheduled Payment',
};

const ITEM_TYPE_ICON: Record<SmsPaymentMatchCandidate['itemType'], keyof typeof Ionicons.glyphMap> = {
  loan: 'cash-outline',
  insurance: 'shield-outline',
  scheduled_payment: 'calendar-outline',
};

export default function PaymentMatchReviewsScreen() {
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const queryClient = useQueryClient();

  const { data: reviews = [], isLoading } = useQuery({
    queryKey: ['/api/sms-payment-match-reviews/pending'],
    queryFn: api.getPendingPaymentMatchReviews,
  });

  const invalidateAfterResolve = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/sms-payment-match-reviews/pending'] });
    queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
    queryClient.invalidateQueries({ queryKey: ['/api/insurances'] });
    queryClient.invalidateQueries({ queryKey: ['/api/payment-occurrences'] });
    queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
    queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
  };

  const resolveMutation = useMutation({
    mutationFn: ({ reviewId, candidate }: { reviewId: number; candidate: SmsPaymentMatchCandidate }) =>
      api.resolvePaymentMatchReview(reviewId, candidate.itemType, candidate.itemId),
    onSuccess: () => {
      invalidateAfterResolve();
      Toast.show({ type: 'success', text1: 'Marked as Paid', position: 'bottom' });
    },
    onError: () => {
      Toast.show({ type: 'error', text1: 'Failed to Link', position: 'bottom' });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (reviewId: number) => api.dismissPaymentMatchReview(reviewId),
    onSuccess: () => {
      invalidateAfterResolve();
      Toast.show({ type: 'success', text1: 'Dismissed', text2: 'Nothing was marked paid', position: 'bottom' });
    },
    onError: () => {
      Toast.show({ type: 'error', text1: 'Failed to Dismiss', position: 'bottom' });
    },
  });

  const handleDismiss = (reviewId: number) => {
    Alert.alert(
      'Dismiss this match?',
      "Nothing will be marked paid — you'll need to mark the right item paid manually.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Dismiss', style: 'destructive', onPress: () => dismissMutation.mutate(reviewId) },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.infoCard, { backgroundColor: `${colors.primary}15` }]}>
          <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.text }]}>
            A debited SMS matched more than one auto-mark-as-paid item on amount and keyword, so nothing was marked
            automatically. Pick which one it actually paid, or dismiss to leave everything pending.
          </Text>
        </View>

        {reviews.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-circle-outline" size={48} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.text }]}>Nothing to review</Text>
            <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
              No ambiguous payment matches right now.
            </Text>
          </View>
        ) : (
          reviews.map((review) => (
            <View key={review.id} style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  {formatCurrency(parseFloat(review.amount))}
                </Text>
                <TouchableOpacity onPress={() => handleDismiss(review.id)} disabled={dismissMutation.isPending}>
                  <Ionicons name="close-circle-outline" size={20} color="#ef4444" />
                </TouchableOpacity>
              </View>
              <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                {review.candidates.length} possible matches — which one was this?
              </Text>

              {review.candidates.map((candidate) => (
                <TouchableOpacity
                  key={`${candidate.itemType}-${candidate.itemId}`}
                  style={[styles.candidateRow, { borderColor: colors.border }]}
                  disabled={resolveMutation.isPending}
                  onPress={() => resolveMutation.mutate({ reviewId: review.id, candidate })}
                >
                  <Ionicons name={ITEM_TYPE_ICON[candidate.itemType]} size={18} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.candidateName, { color: colors.text }]}>{candidate.itemName}</Text>
                    <Text style={[styles.candidateMeta, { color: colors.textMuted }]}>
                      {ITEM_TYPE_LABEL[candidate.itemType]} · Due {format(new Date(candidate.dueDate), 'd MMM')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
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
  scrollContent: {
    padding: 16,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: 13,
    textAlign: 'center',
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  cardMeta: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 12,
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderTopWidth: 1,
  },
  candidateName: {
    fontSize: 14,
    fontWeight: '500',
  },
  candidateMeta: {
    fontSize: 12,
    marginTop: 2,
  },
});
