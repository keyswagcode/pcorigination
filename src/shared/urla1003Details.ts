// Shared definitions for the post-pre-approval URLA 1003 details we collect:
// Section 5 (Declarations), Section 7 (Military), Section 8 (Demographic/HMDA).
// Used by both the collection form and the 1003 generator so labels/keys match.

export type YesNo = 'yes' | 'no' | null;

export interface Urla1003Declarations {
  occupyPrimary: YesNo;            // 5a-A
  ownedLast3Yrs: YesNo;            // 5a-B
  priorPropertyType: 'PR' | 'SH' | 'IP' | null; // 5a-C (if B = yes)
  priorTitleHeld: 'S' | 'SP' | 'O' | null;      // 5a-D (if B = yes)
  borrowingOtherMoney: YesNo;      // 5a-E
  applyingOtherMortgage: YesNo;    // 5a-F
  applyingNewCredit: YesNo;        // 5a-G
  priorityLien: YesNo;             // 5a-H
  coSignerGuarantor: YesNo;        // 5b-I
  outstandingJudgments: YesNo;     // 5b-J
  federalDebtDelinquent: YesNo;    // 5b-K
  partyToLawsuit: YesNo;           // 5b-L
  conveyedTitleInLieu: YesNo;      // 5b-M
  shortSale: YesNo;                // 5b-N
  foreclosure: YesNo;              // 5b-O
  bankruptcy: YesNo;               // 5b-P
  bankruptcyTypes: string[];       // Ch 7 / 11 / 12 / 13 (if P = yes)
}

export interface Urla1003Military {
  servedOrServing: YesNo;
  currentlyActiveDuty: boolean;
  retiredDischargedSeparated: boolean;
  nonActivatedReserveGuard: boolean;
  survivingSpouse: boolean;
  tourEndDate: string | null;
}

export interface Urla1003Demographic {
  ethnicity: string[];
  ethnicityDoNotWish: boolean;
  race: string[];
  raceDoNotWish: boolean;
  sex: 'Female' | 'Male' | null;
  sexDoNotWish: boolean;
}

export interface DeclarationQuestion { key: keyof Urla1003Declarations; label: string }

export const DECLARATIONS_5A: DeclarationQuestion[] = [
  { key: 'occupyPrimary', label: 'A. Will you occupy the property as your primary residence?' },
  { key: 'ownedLast3Yrs', label: 'B. Have you had an ownership interest in another property in the last three years?' },
  { key: 'borrowingOtherMoney', label: 'E. Are you borrowing any money for this real estate transaction (other than this loan)?' },
  { key: 'applyingOtherMortgage', label: 'F. Have you or will you be applying for a mortgage loan on another property before this loan closes?' },
  { key: 'applyingNewCredit', label: 'G. Have you or will you be applying for any new credit before this loan closes?' },
  { key: 'priorityLien', label: 'H. Will this property be subject to a lien that could take priority over the first mortgage lien?' },
];

export const DECLARATIONS_5B: DeclarationQuestion[] = [
  { key: 'coSignerGuarantor', label: 'I. Are you a co-signer or guarantor on any debt or loan that is not disclosed on this application?' },
  { key: 'outstandingJudgments', label: 'J. Are there any outstanding judgments against you?' },
  { key: 'federalDebtDelinquent', label: 'K. Are you currently delinquent or in default on a Federal debt?' },
  { key: 'partyToLawsuit', label: 'L. Are you a party to a lawsuit in which you potentially have any personal financial liability?' },
  { key: 'conveyedTitleInLieu', label: 'M. Have you conveyed title to any property in lieu of foreclosure in the past 7 years?' },
  { key: 'shortSale', label: 'N. Have you completed a pre-foreclosure sale or short sale in the past 7 years?' },
  { key: 'foreclosure', label: 'O. Have you had property foreclosed upon in the past 7 years?' },
  { key: 'bankruptcy', label: 'P. Have you declared bankruptcy in the past 7 years?' },
];

export const PRIOR_PROPERTY_TYPE_OPTIONS = [
  { value: 'PR', label: 'Primary Residence' },
  { value: 'SH', label: 'Second Home' },
  { value: 'IP', label: 'Investment Property' },
] as const;

export const PRIOR_TITLE_OPTIONS = [
  { value: 'S', label: 'Sole' },
  { value: 'SP', label: 'Jointly with Spouse' },
  { value: 'O', label: 'Jointly with Other' },
] as const;

export const BANKRUPTCY_TYPES = ['Chapter 7', 'Chapter 11', 'Chapter 12', 'Chapter 13'];

export const HMDA_ETHNICITY = ['Hispanic or Latino', 'Not Hispanic or Latino'];
export const HMDA_RACE = [
  'American Indian or Alaska Native',
  'Asian',
  'Black or African American',
  'Native Hawaiian or Other Pacific Islander',
  'White',
];
export const HMDA_SEX = ['Female', 'Male'] as const;

export function emptyDeclarations(): Urla1003Declarations {
  return {
    occupyPrimary: null, ownedLast3Yrs: null, priorPropertyType: null, priorTitleHeld: null,
    borrowingOtherMoney: null, applyingOtherMortgage: null, applyingNewCredit: null, priorityLien: null,
    coSignerGuarantor: null, outstandingJudgments: null, federalDebtDelinquent: null, partyToLawsuit: null,
    conveyedTitleInLieu: null, shortSale: null, foreclosure: null, bankruptcy: null, bankruptcyTypes: [],
  };
}

export function emptyMilitary(): Urla1003Military {
  return {
    servedOrServing: null, currentlyActiveDuty: false, retiredDischargedSeparated: false,
    nonActivatedReserveGuard: false, survivingSpouse: false, tourEndDate: null,
  };
}

export function emptyDemographic(): Urla1003Demographic {
  return { ethnicity: [], ethnicityDoNotWish: false, race: [], raceDoNotWish: false, sex: null, sexDoNotWish: false };
}
