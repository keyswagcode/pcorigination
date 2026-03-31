export type PropertyType = 'investment' | 'mixed_use' | 'primary';

export interface LenderRule {
  id: string;
  name: string;
  program: string;
  min_credit?: number;
  min_dscr?: number;
  allowed_property_types: PropertyType[];
  no_seasoning_supported: boolean;
  low_credit_supported: boolean;
  short_term_rental_allowed: boolean;
  foreign_national_allowed: boolean;
  notes: string;
}

export const LENDER_RULES: LenderRule[] = [
  {
    id: 'verus',
    name: 'Verus',
    program: 'DSCR',
    min_credit: 680,
    min_dscr: 1.0,
    allowed_property_types: ['investment'],
    no_seasoning_supported: false,
    low_credit_supported: false,
    short_term_rental_allowed: true,
    foreign_national_allowed: false,
    notes: 'Structured, standard DSCR lender. Best for clean deals.',
  },
  {
    id: 'ahl_funding',
    name: 'AHL Funding',
    program: 'DSCR',
    min_credit: 660,
    min_dscr: 1.0,
    allowed_property_types: ['investment'],
    no_seasoning_supported: true,
    low_credit_supported: false,
    short_term_rental_allowed: false,
    foreign_national_allowed: false,
    notes: 'Good for recently acquired properties with no seasoning.',
  },
  {
    id: 'champions_funding',
    name: 'Champions Funding',
    program: 'DSCR',
    min_dscr: 1.0,
    allowed_property_types: ['investment'],
    no_seasoning_supported: true,
    low_credit_supported: false,
    short_term_rental_allowed: false,
    foreign_national_allowed: false,
    notes: 'Alternative no-seasoning lender.',
  },
  {
    id: 'constructive_capital',
    name: 'Constructive Capital',
    program: 'DSCR / Bridge',
    min_dscr: 0.75,
    allowed_property_types: ['investment', 'mixed_use'],
    no_seasoning_supported: true,
    low_credit_supported: true,
    short_term_rental_allowed: false,
    foreign_national_allowed: false,
    notes: 'Flexible lender for edge cases — low credit and high leverage supported.',
  },
];
