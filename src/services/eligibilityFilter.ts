export type { EligibilityResult, EligibilityCheck } from '../shared/types';
export {
  evaluateLoanPackage as runEligibilityFilter,
  runServerEligibility,
  checkCredit as checkCreditEligibility,
  checkLTV as checkLTVEligibility,
  checkDSCR as checkDSCREligibility,
  checkProperty as checkPropertyEligibility,
  checkLoanAmount as checkLoanAmountEligibility,
} from './lenderRulesService';
