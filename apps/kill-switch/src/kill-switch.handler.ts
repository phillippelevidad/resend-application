import { createKillSwitchHandler } from './create-kill-switch-handler.ts';
import { invocation, logger, trip } from './main.ts';

// The CDK entry (pp-infra): the adapter of D29 bound to what the composition root built once per
// container (D14's layout).
export const handler = createKillSwitchHandler({ trip, logger, invocation });
