/**
 * CardRefreshContext — provides a refresh callback from DynamicCard to
 * child renderers (ToggleRenderer, ActionRenderer) so they can trigger
 * a data re-fetch after a mutation.
 */

import { createContext, useContext } from "react";

export type CardRefreshFn = () => void;

export const CardRefreshContext = createContext<CardRefreshFn>(() => {});

export function useCardRefresh(): CardRefreshFn {
  return useContext(CardRefreshContext);
}
