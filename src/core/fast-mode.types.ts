import type { RoutingMode } from './configuration';
import type { SpeedMode } from './speed-mode';

/** The pair of settings Fast mode moves, and puts back. */
export interface FastModeSettings {
  readonly routingMode: RoutingMode;
  readonly speedMode: SpeedMode;
}
