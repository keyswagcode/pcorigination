import { PlacerBotPage } from '../../components/placerbot/PlacerBotPage';

export function InternalPlacerBotPage() {
  return <PlacerBotPage onBack={() => window.history.back()} />;
}
