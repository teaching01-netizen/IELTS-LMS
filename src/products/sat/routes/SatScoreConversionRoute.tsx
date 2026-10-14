import { ScoreConversionPage } from '../../../features/sat-score-conversion/ui/ScoreConversionPage';

/** `/sat/score-conversion` (admin only; the route guard in createRouter enforces the role). */
export function SatScoreConversionRoute() {
  return <ScoreConversionPage />;
}
