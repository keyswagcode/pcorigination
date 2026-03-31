export { PlacerBotPanel } from './PlacerBotPanel';
export { PlacerBotPage } from './PlacerBotPage';

export { routeLoanType, type BorrowerProfile, type LoanType, type RouterResult } from '../../services/placerbot/loanTypeRouter';
export { runDSCREngine, type DSCREngineResult, type DSCRTier } from '../../services/placerbot/dscrEngine';
export { runNQMEngine, type NQMEngineResult } from '../../services/placerbot/nqmEngine';
export { runLenderPlacement, DSCR_LENDERS, NQM_LENDERS, type LenderProgram, type LenderPlacementResult } from '../../services/placerbot/lenderPlacement';
export { runPlacerBotFull, formatForUI, buildBorrowerProfile, type PlacerBotOutput, type PlacerBotUIOutput, type UILenderResult } from '../../services/placerbot/placerBotOrchestrator';
