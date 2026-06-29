import { describe, expect, it } from 'vitest';
import { calculateAffiliateProgramCommission } from './affiliate-program';

describe('calculateAffiliateProgramCommission', () => {
  it('calculates percentage commission rounded down to whole yen', () => {
    expect(
      calculateAffiliateProgramCommission(12345, {
        commission_type: 'percentage',
        commission_rate: 0.1,
        fixed_amount: null,
      }),
    ).toBe(1234);
  });

  it('uses fixed amount for fixed commission partners', () => {
    expect(
      calculateAffiliateProgramCommission(9800, {
        commission_type: 'fixed',
        commission_rate: 0,
        fixed_amount: 500,
      }),
    ).toBe(500);
  });

  it('does not create commission for zero or negative basis amount', () => {
    const partner = {
      commission_type: 'percentage' as const,
      commission_rate: 0.2,
      fixed_amount: null,
    };

    expect(calculateAffiliateProgramCommission(0, partner)).toBe(0);
    expect(calculateAffiliateProgramCommission(-1000, partner)).toBe(0);
  });
});
